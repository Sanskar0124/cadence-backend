// * Utils
const {
  successResponse,
  serverErrorResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  badRequestResponseWithDevMsg,
} = require('../../../utils/response');
const logger = require('../../../utils/winston');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const { OPENAI_API_KEY } = require('../../../utils/config');

// * Package Import
const { Op } = require('sequelize');
const { ChatOpenAI } = require('langchain/chat_models/openai');
const { LLMChain } = require('langchain/chains');
const {
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} = require('langchain/prompts');

// * Repository
const Repository = require('../../../../../Cadence-Brain/src/repository');

// * JOI Imports
const AiSchema = require('../../../joi/v2/ai/ai.joi');

// * Generate email template using OpenAI
const generateEmail = async (req, res) => {
  try {
    // * JOI Validation
    const body = AiSchema.generateEmailSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    //TODO: Add user quota check (based on plan)
    // * Check how many requests have been made by the user in the past 24 hours
    let [openAiRequestCount, errFetchingOpenAiRequestCount] =
      await Repository.count({
        tableName: DB_TABLES.OPENAI_LOG,
        query: {
          user_id: req.user.user_id,
          created_at: {
            [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      });
    if (errFetchingOpenAiRequestCount)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Cannot generate email at this moment',
        error: errFetchingOpenAiRequestCount,
      });
    if (openAiRequestCount > 50)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You have exhausted your daily AI email generation quota, please try again in 24 hours',
      });

    // * System prompt for OpenAI
    const SYS_PROMPT = `Imagine you are a marketing manager of a company and you are an expert in cold email campaigns.
    You are in charge of writing cold email campaigns, your objective is to maximize the opening and convertion rates of such emails.
    For that, you use the best practices and case studies about how to write impactful subject lines and email bodies.
    Depending on the tone of voice required, you may use some emojis to optimize your results.
    IMPORTANT : Avoid generic formulations such as "I hope this finds you well" at all cost. Be original and smart.
    
    You should write the email keeping in mind the following instructions:
    
    ===
    Use the following variables enclosed in double brackets whenever you are referring to the recipient:
    First Name = first_name
    Last Name = last_name
    Company Name = company_name
    Job Position = job_position
    
    Use the following variables enclosed in double brackets whenever you are referring to yourself as the sender:
    First Name = sender_first_name
    Last Name = sender_last_name
    Company Name = sender_company
    
    Total length of the email subject should not be more than 70 characters
    Total length of the email body should not be more then 3000 characters
    
    The default tone of the email should be professional, unless specified otherwise below.
    
    In terms of output, generate the Subject and Body of the email as two separate Json strings.
    ===
    
    Given below is JSON that describes the information to extract from this document and the tags to extract it into.
    '''
    subject: str, // The Email Object
    body: str // The Email Body
    '''
    `;

    // * Construct human message prompt
    let constructedHumanMessagePrompt = req.body.prompt;
    if (req.body.problem_statement || req.body.key_benefits)
      constructedHumanMessagePrompt +=
        constructedHumanMessagePrompt + `\n === `;
    if (req.body.problem_statement)
      constructedHumanMessagePrompt += `\n Problem statement - ${req.body.problem_statement}`;
    if (req.body.key_benefits)
      constructedHumanMessagePrompt += `\n Key benefits - ${req.body.key_benefits} - Must be redacted in bullet points for more readability`;
    if (req.body.problem_statement || req.body.key_benefits)
      constructedHumanMessagePrompt +=
        constructedHumanMessagePrompt + `\n === `;

    let systemMessagePrompt =
      SystemMessagePromptTemplate.fromTemplate(SYS_PROMPT);
    let humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
      constructedHumanMessagePrompt
    );
    const chatPrompt = ChatPromptTemplate.fromPromptMessages([
      systemMessagePrompt,
      humanMessagePrompt,
    ]);

    const chat = new ChatOpenAI({
      temperature: 0,
      openAIApiKey: OPENAI_API_KEY,
    });

    const chain = new LLMChain({
      llm: chat,
      prompt: chatPrompt,
    });
    const result = await chain.call();
    console.log('Open AI Response: ' + result.text);
    let { subject, body: email_body } = JSON.parse(result.text);

    // * Log request
    Repository.create({
      tableName: DB_TABLES.OPENAI_LOG,
      createObject: {
        prompt: req.body.prompt,
        response: result.text,
        user_id: req.user.user_id,
      },
    });

    // DO NOT REMOVE COMMENT.
    // openAiResponse = openAiResponse.replace(
    //   /("[^"]*")|\s+|,(\s*[}\]])/g,
    //   (match, group1, group2) => {
    //     if (group1) return group1;
    //     else if (group2) return group2;
    //     else return '';
    //   }
    // );
    // openAiResponse = openAiResponse.replace(/\n/g, '\\n');

    // * Response
    return successResponse(res, 'Successfully generated email', {
      subject,
      body: email_body,
    });
  } catch (err) {
    logger.error(`An error occurred while generating mail from OpenAI : `, {
      user_id: req.user.user_id,
      err,
    });
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Cannot generate email at this moment',
      error: err.message,
    });
  }
};

module.exports = {
  generateEmail,
};

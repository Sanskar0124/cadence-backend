// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  DB_TABLES,
  DB_MODELS,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  NOTIFICATION_TYPES,
  CHATBOT_THREAD_STATUS,
  CRM_INTEGRATIONS,
  CHATBOT_TOKEN_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  SLACK_CHATBOT_CHANNEL,
  SLACK_CHATBOT_CHANNEL_ID,
  FRONTEND_URL,
} = require('../../../../../Cadence-Brain/src/utils/config');
const {
  SUPPORT_AGENT_ACCESS_DURATION,
} = require('../../../../../Cadence-Brain/src/utils/constants');

//Packages
const { Op } = require('sequelize');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

//Helpers and services
const ChatbotHelper = require('../../../../../Cadence-Brain/src/helper/chatbot');
const SocketHelper = require('../../../../../Cadence-Brain/src/helper/socket');
const SlackHelper = require('../../../../../Cadence-Brain/src/helper/slack');
const UserTokensHelper = require('../../../../../Cadence-Brain/src/helper/userTokens');

// Other
const token = require('../../v1/user/authentication/token');

const sendMessage = async (req, res) => {
  try {
    if (
      req.file &&
      !/.*\.(gif|jpe?g|tiff?|png|webp|bmp|mp4|mov|wmv|avi|mkv)$/i.test(
        req.file.originalname
      )
    )
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unsupported file extension',
      });
    // if (!req.body.issue_id) {
    let [issue, errForIssues] = await Repository.fetchOne({
      tableName: DB_TABLES.CHATBOT,
      query: {
        [Op.and]: [
          { user_id: req.user.user_id },
          { status: CHATBOT_THREAD_STATUS.PENDING },
        ],
      },
      extras: {
        attributes: ['slack_thread_id', 'issue_id'],
      },
    });
    if (errForIssues)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to send message',
        error: `Error while fething chatbot: ${errForIssues}`,
      });
    if (!issue) {
      let thread = {
        user_id: req.user.user_id,
      };
      const [createdChatbotThread, errForCreatedChatbotThread] =
        await Repository.create({
          tableName: DB_TABLES.CHATBOT,
          createObject: thread,
        });
      if (errForCreatedChatbotThread)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to send message',
          error: `Error while creating chatbot thread: ${errForCreatedChatbotThread}`,
        });

      let [user, errForUser] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: { user_id: req.user.user_id },
        include: {
          [DB_TABLES.COMPANY]: {
            [DB_TABLES.COMPANY_SETTINGS]: {},
          },
          [DB_TABLES.SUB_DEPARTMENT]: {},
        },
      });
      if (errForUser)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to send message',
          error: `Error while fetching user: ${errForUser}`,
        });

      if (!user.Sub_Department)
        user.Sub_Department = {
          name: '',
        };
      let message = {
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        company: user.Company?.name,
        role: user.role,
        user_id: user.user_id,
        subDepartment: user.Sub_Department.name,
        timeZone: user.timezone,
        lang: user.language,
        integration_type: user.Company?.integration_type,
        mail_integration_type:
          user.Company?.Company_Setting?.mail_integration_type,
      };
      message.issue_id = createdChatbotThread.issue_id;
      let [thread_id, err] = await ChatbotHelper.sendInitMessage(message);
      if (err)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to send message',
          error: `Error while sending init message: ${err}`,
        });

      Repository.update({
        tableName: DB_TABLES.CHATBOT,
        updateObject: { slack_thread_id: thread_id },
        query: { issue_id: createdChatbotThread.issue_id },
      });
      req.body.thread_id = thread_id;
      req.body.issue_id = createdChatbotThread.issue_id;
    } else {
      req.body.thread_id = issue.slack_thread_id;
      req.body.issue_id = issue.issue_id;
    }
    // } else {
    //   let [thread, errForThread] = await Repository.fetchOne({
    //     tableName: DB_TABLES.CHATBOT,
    //     query: { issue_id: req.body.issue_id },
    //   });
    //   if (errForThread) return serverErrorResponse(res, errForThread);
    //   req.body.thread_id = thread.slack_thread_id;
    // }
    if (req.file) {
      let [data, err] = await SlackHelper.sendSlackFile({
        file: req.file,
        thread_id: req.body.thread_id,
        channel: SLACK_CHATBOT_CHANNEL,
        text: req.body.text,
      });
      if (err && !err.includes('status code 408'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to send message',
          error: `Error while sending slack file: ${err.message}`,
        });
      const [public_url, errForPublicURL] = await SlackHelper.getPublicURL({
        permalink_public: data.file.permalink_public,
        url_private: data.file.url_private,
      });
      if (errForPublicURL)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to send message',
          error: `Error while sending public url: ${errForPublicURL}`,
        });

      // Sending init message to user
      if (!issue) {
        const [_, errForMessage] = await SlackHelper.sendSlackMessage({
          tokenType: CHATBOT_TOKEN_TYPES.USER,
          text: {
            text: 'Hello, we usually reply in 10-15 minutes. You can also contact us at support.cadence@ringover.com.',
          },
          channel: SLACK_CHATBOT_CHANNEL,
          thread_id: req.body.thread_id,
        });
        if (errForMessage)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to send message',
            error: `Error while sending slack message: ${errForMessage}`,
          });
      }

      return successResponse(res, 'File sent successfully', [
        {
          text: req.body.text,
          files: [data.file],
        },
      ]);
    }
    if (req.body.text) {
      let [data, err] = await SlackHelper.sendSlackMessage({
        tokenType: CHATBOT_TOKEN_TYPES.CHATBOT,
        text: { text: req.body.text },
        thread_id: req.body.thread_id,
        channel: SLACK_CHATBOT_CHANNEL,
      });
      if (err)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to send message',
          error: `Error while sending slcak message: ${err.message}`,
        });

      // Sending init message to user
      if (!issue) {
        const [sendMessage, errForMessage] = await SlackHelper.sendSlackMessage(
          {
            tokenType: CHATBOT_TOKEN_TYPES.USER,
            text: {
              text: 'Hello, we usually reply in 10-15 minutes. You can also contact us at support.cadence@ringover.com.',
            },
            channel: SLACK_CHATBOT_CHANNEL,
            thread_id: req.body.thread_id,
          }
        );
        if (errForMessage)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to send message',
            error: `Error while sending slack message: ${errForMessage}`,
          });

        // Tagging support users randomly
        let support = [];
        if (process.env.SERVER_URL === 'https://cadence-api.ringover.com')
          support = ['U03AWE562BZ', 'U042Y7PDC4S'];
        // For Production Thiffany and Kalyani
        else support = ['U020RBC2WFP', 'U04H41B83D3']; // For Testing Sanskar and Dnyaneshwar

        const random = Math.floor(Math.random() * support.length);
        const [_, errForMessage2] = await SlackHelper.sendSlackMessage({
          tokenType: CHATBOT_TOKEN_TYPES.CHATBOT,
          type: 'mrkdwn',
          text: {
            text: `<@${support[random]}> New issue is assigned to you #Mentions`,
          },
          channel: SLACK_CHATBOT_CHANNEL,
          thread_id: req.body.thread_id,
        });
        if (errForMessage2)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to send message',
            error: `Error while sending slack message: ${errForMessage2}`,
          });
      }

      return successResponse(res, 'Message sent successfully', [
        {
          text: req.body.text,
        },
      ]);
    }

    return badRequestResponseWithDevMsg({
      res,
      msg: 'Append either text or files to send to slack',
    });
  } catch (err) {
    logger.error('Error while sending files to slack :', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while sending files to slack: ${err.message}`,
    });
  }
};

const getPendingIssues = async (req, res) => {
  try {
    let [issues, errForIssues] = await Repository.fetchAll({
      tableName: DB_TABLES.CHATBOT,
      query: {
        [Op.and]: [
          { user_id: req.user.user_id },
          { status: CHATBOT_THREAD_STATUS.PENDING },
        ],
      },
      extras: {
        attributes: ['slack_thread_id', 'issue_id'],
      },
    });
    if (errForIssues)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch pending issues',
        error: `Error while fetching chatbot pending threads: ${errForIssues}`,
      });
    return successResponse(res, 'Issues fetched successfully', issues);
  } catch (err) {
    logger.error('Error while getting pending issues :', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while getting pending issues: ${err.message}`,
    });
  }
};

const getCurrentConversation = async (req, res) => {
  try {
    let [issue, errForIssues] = await Repository.fetchOne({
      tableName: DB_TABLES.CHATBOT,
      query: {
        [Op.and]: [
          { user_id: req.user.user_id },
          { status: CHATBOT_THREAD_STATUS.PENDING },
        ],
      },
      extras: {
        attributes: ['slack_thread_id', 'issue_id'],
      },
    });
    if (errForIssues)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch chatbot messages',
        error: `Error while fetching chatbot pending thread: ${errForIssues}`,
      });
    if (!issue)
      return successResponse(res, 'Conversation fetched successfully', []);
    const [conversation, errForConversation] =
      await SlackHelper.getConversationFromSlackThread({
        thread_id: issue.slack_thread_id,
        channel: SLACK_CHATBOT_CHANNEL_ID,
      });
    if (errForConversation)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch chatbot messages',
        error: `Error while fetching conversation from slack thread: ${errForConversation}`,
      });
    console.log(conversation.data);
    console.log(conversation.data.messages);
    conversation.data.messages.shift();
    return successResponse(
      res,
      'Conversation fetched successfully',
      conversation.data.messages
    );
  } catch (err) {
    logger.error('Error while getting current conversation :', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while getting current conversation: ${err.message}`,
    });
  }
};

const receiveMessage = async (req, res) => {
  try {
    if (req.body.challenge)
      return successResponse(res, 'Success', req.body.challenge);
    if (req.body.event.bot_id && req.body.event.user === 'U020RBC2WFP') {
      req.body.event.client_msg_id = req.body.event.bot_id;
      delete req.body.event.bot_id;
    }
    if (req.body.event.client_msg_id) {
      let [thread, errForThread] = await Repository.fetchOne({
        tableName: DB_TABLES.CHATBOT,
        query: { slack_thread_id: req.body.event.thread_ts },
      });
      if (errForThread)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to receive message',
          error: `Error while fetching chatbot: ${errForThread}`,
        });
      if (!thread || thread.status == 'complete')
        return serverErrorResponseWithDevMsg({ res, msg: 'Invalid thread' });

      const [support_agent, errForSupportAgent] =
        await SlackHelper.getUserDetails(req.body.event.user);
      if (errForSupportAgent)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to receive message',
          error: `Error while fetching user details: ${errForSupportAgent}`,
        });
      //console.log(support_agent);
      const [user, errForUser] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: { user_id: thread.user_id },
      });
      if (errForUser)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to receive message',
          error: `Error while fetching user: ${errForUser}`,
        });

      let message = {};
      message.ts = req.body.event.ts;
      message.client_msg_id = req.body.event.client_msg_id;
      message.user_id = user.user_id;
      message.email = user.email;
      if (req.body.event.text) message.text = req.body.event.text;
      if (req.body.event.files) {
        const file = req.body.event.files[0];
        const [public_url, errForPublicURL] = await SlackHelper.getPublicURL({
          permalink_public: file.permalink_public,
          url_private: file.url_private,
        });
        if (errForPublicURL)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to receive message',
            error: `Error while fetching public url: ${errForPublicURL}`,
          });
        message.file = {};
        message.file.url_private = file.url_private;
        message.file.permalink_public = file.permalink_public;
        message.file.mimetype = file.mimetype;
        message.file.name = file.name;
      }
      const [_, errForMessage] = await SocketHelper.sendChatbotMessageToUser(
        message
      );
      if (errForMessage)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to receive message',
          error: `Error while sending chatbot message to user: ${errForMessage}`,
        });
      return successResponse(res, 'Message sent');
    }
  } catch (err) {
    logger.error('Error while receiving messages :', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while receiving messages: ${err.message}`,
    });
  }
};

const resolveIssue = async (req, res) => {
  try {
    const [thread, errForThread] = await Repository.fetchOne({
      tableName: DB_TABLES.CHATBOT,
      query: {
        [Op.and]: [
          { user_id: req.user.user_id },
          { status: CHATBOT_THREAD_STATUS.PENDING },
        ],
      },
      extras: {
        attributes: ['status'],
      },
    });
    if (errForThread)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to resolve issue',
        error: `Error while fetching chatbot pending thread: ${errForThread}`,
      });
    if (thread && thread.status == CHATBOT_THREAD_STATUS.COMPLETE)
      return successResponse(res, 'No pending issues');

    const resolveDate = new Date();
    const timeToResolve = resolveDate.getTime();
    Repository.update({
      tableName: DB_TABLES.CHATBOT,
      updateObject: {
        status: CHATBOT_THREAD_STATUS.COMPLETE,
        resolution_time: timeToResolve,
      },
      query: { user_id: req.user.user_id },
    });
    return successResponse(res, 'Issue resolved succesfully', timeToResolve);
  } catch (err) {
    logger.error('Error while resolving issue :', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while resolving issue: ${err.message}`,
    });
  }
};

const getPublicURL = async (req, res) => {
  try {
    if (!req.body.url_private || !req.body.permalink_public)
      return badRequestResponseWithDevMsg({ res, msg: 'Links not included' });
    const [public_url, errForPublicURL] = await SlackHelper.getPublicURL({
      permalink_public: req.body.permalink_public,
      url_private: req.body.url_private,
    });
    if (errForPublicURL)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch public url',
        error: `Error while fetching public url: ${errForPublicURL}`,
      });
    return successResponse(res, 'File made public', public_url);
  } catch (err) {
    logger.error('Error while making file public:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while making file public: ${err.message}`,
    });
  }
};

const grantSupportAgentAccess = async (req, res) => {
  try {
    const [issue, errForIssue] = await Repository.fetchOne({
      tableName: DB_TABLES.CHATBOT,
      query: {
        [Op.and]: [
          { user_id: req.user.user_id },
          { status: CHATBOT_THREAD_STATUS.PENDING },
        ],
      },
    });
    if (errForIssue)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to giving support agent access',
        error: `Error while fetching chatbot: ${errForIssue}`,
      });
    if (!issue)
      return serverErrorResponseWithDevMsg({ res, msg: 'No pending issues' });

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    const nowInMSeconds = new Date().getTime();
    if (issue.support_agent_access_start_time) {
      const prevExpiryTime =
        issue.support_agent_access_start_time + SUPPORT_AGENT_ACCESS_DURATION;
      if (prevExpiryTime > nowInMSeconds)
        return successResponse(
          res,
          `Access already granted till ${new Date(
            prevExpiryTime
          ).toLocaleString('en-US', { timeZone: user.timezone })}`
        );
    }
    const url = FRONTEND_URL + `/crm/access?id=${issue.issue_id}`;
    const expiryTime = new Date(
      nowInMSeconds + SUPPORT_AGENT_ACCESS_DURATION
    ).toLocaleString('en-US', { timeZone: user.timezone });
    const text = url + `\nAccess granted till ${expiryTime}`;
    const [_, errForMessage] = await SlackHelper.sendSlackMessage({
      tokenType: CHATBOT_TOKEN_TYPES.CHATBOT,
      text: { text },
      channel: SLACK_CHATBOT_CHANNEL,
      thread_id: issue.slack_thread_id,
    });
    if (errForMessage)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to giving support agent access',
        error: `Error while sending slack message: ${errForMessage}`,
      });

    const [__, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.CHATBOT,
      query: {
        [Op.and]: [
          { user_id: req.user.user_id },
          { status: CHATBOT_THREAD_STATUS.PENDING },
        ],
      },
      updateObject: {
        support_agent_access_start_time: nowInMSeconds,
      },
    });
    if (errForUpdate)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to giving support agent access',
        error: `Error while updating chatbot pending thread: ${errForUpdate}`,
      });

    return successResponse(res, 'Support agent granted access');
  } catch (err) {
    logger.error('Error while giving support agent access', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while giving support agent access: ${err.message}`,
    });
  }
};

const supportAgentLoginAsUser = async (req, res) => {
  try {
    const { user_id } = req.user;

    const [requestUser, errForRequestUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: ['is_subscription_active', 'is_trial_active'],
        },
      },
    });
    if (errForRequestUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to login',
        error: `Error while fetching user: ${errForRequestUser}`,
      });
    const { issue_id } = req.query;
    if (!issue_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to login',
        error: 'Request does not have issue id',
      });

    let tokens;
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        tokens = DB_TABLES.SALESFORCE_TOKENS;
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        tokens = DB_TABLES.PIPEDRIVE_TOKENS;
        break;
    }

    const [issue, errForIssue] = await Repository.fetchOne({
      tableName: DB_TABLES.CHATBOT,
      query: {
        issue_id,
      },
    });
    if (errForIssue)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to login',
        error: `Error while fetching chatbot: ${errForIssue}`,
      });
    if (!issue)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to login',
        error: 'Issue with this issue id does not exist',
      });

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: issue.user_id },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: [
            'is_subscription_active',
            'is_trial_active',
            'integration_type',
          ],
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: ['phone_system', 'mail_integration_type'],
          },
        },
        [tokens]: {},
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to login',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'No issue found',
      });

    if (!issue.support_agent_access_start_time)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please request permission to access account',
      });
    const start_time = issue.support_agent_access_start_time;
    const current_time = new Date().getTime();
    const permitted_time = SUPPORT_AGENT_ACCESS_DURATION; //ms for 1 hour
    if (current_time - start_time > permitted_time)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Access time limit expired',
      });

    if (
      user?.Company?.is_subscription_active ||
      user?.Company?.is_trial_active
    ) {
      const accessToken = token.access.generate(
        user.user_id,
        user.email,
        user.first_name,
        user.role,
        user.sd_id
      );

      const [_, errForValidToken] = await UserTokensHelper.setValidAccessToken(
        accessToken,
        user.user_id,
        new Date().getTime() + parseInt(SUPPORT_AGENT_ACCESS_DURATION)
      );
      if (errForValidToken)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to login',
          error: `Error while setting valid access token: ${errForValidToken}`,
        });

      let instance_url = '';
      switch (req.user.integration_type) {
        case CRM_INTEGRATIONS.SALESFORCE:
          instance_url = user?.Salesforce_Token?.instance_url || '';
          break;
        case CRM_INTEGRATIONS.PIPEDRIVE:
          instance_url = user?.Pipedrive_Token?.instance_url || '';
          break;
      }

      return successResponse(res, 'Successfully logged in.', {
        accessToken,
        user_id: user.user_id,
        sd_id: user.sd_id,
        company_id: user.company_id,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        email: user.email,
        primary_email: user.primary_email,
        linkedin_url: user.linkedin_url,
        primary_phone_number: user.primary_phone_number,
        timezone: user.timezone,
        profile_picture: user.profile_picture,
        is_call_iframe_fixed: user.is_call_iframe_fixed,
        language: user.language,
        integration_type: user?.Company?.integration_type,
        instance_url,
        phone_system: user.Company.Company_Setting.phone_system,
        mail_integration_type:
          user.Company.Company_Setting.mail_integration_type,
      });
    }
  } catch (err) {
    logger.error(`Error while logging in user: `, err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while logging in user: ${err.message}`,
    });
  }
};
const ChatbotController = {
  sendMessage,
  getPendingIssues,
  receiveMessage,
  resolveIssue,
  getCurrentConversation,
  getPublicURL,
  grantSupportAgentAccess,
  supportAgentLoginAsUser,
};

module.exports = ChatbotController;

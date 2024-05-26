// Utils
const logger = require('../../../../utils/winston');
const {
  serverErrorResponse,
  successResponse,
} = require('../../../../utils/response');

// Repositories
const AttachmentRepository = require('../../../../../../Cadence-Brain/src/repository/attachment.repository');

const createAttachments = async (req, res) => {
  try {
    logger.info(`Received ${req.files.length} files.`);

    // * saving files here in proper structure
    let attachments = [];

    // * create attachments
    for (let file of req.files) {
      attachments.push({
        original_name: file.originalname,
        content: file.buffer,
        content_type: file.mimetype,
      });
    }

    // * save attachments
    const [createdAttachments, errForCreatedAttachments] =
      await AttachmentRepository.createMultipleAttachment(attachments);
    if (errForCreatedAttachments)
      return serverErrorResponse(res, errForCreatedAttachments);

    // * return array of attachments in response
    return successResponse(res, 'Saved attachments.', createdAttachments);
  } catch (err) {
    logger.error(`Error while creating attachments: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const AttachmentsController = {
  createAttachments,
};

module.exports = AttachmentsController;

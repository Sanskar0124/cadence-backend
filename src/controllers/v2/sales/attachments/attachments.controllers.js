// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');
const { Op } = require('sequelize');
// *
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const AttachmentHelper = require('../../../../../../Cadence-Brain/src/helper/attachments');

const getAttachmentById = async (req, res) => {
  try {
    // * Fetch attachment by Id
    let [attachment, errFetchingAttachment] = await Repository.fetchAll({
      tableName: DB_TABLES.ATTACHMENT,
      query: {
        attachment_id: {
          [Op.in]: req.body,
        },
      },
      extras: {
        attributes: {
          exclude: ['created_at', 'updated_at'],
        },
      },
    });
    if (errFetchingAttachment)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch attachment',
        error: `Error while fetching attachment: ${errFetchingAttachment}`,
      });
    if (!attachment)
      return notFoundResponseWithDevMsg({ res, msg: 'Attachment not found' });

    // * Fetched attachment by Id
    return successResponse(res, 'Fetched attachment.', attachment);
  } catch (err) {
    logger.error(`Error while fetching attachments: ${err.message}.`);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching attachments: ${err.message}`,
    });
  }
};
/**
 *
 * @param {*} req req.body.attachment_id
 * @param {*} res
 */
const deleteAttachmentOnRemove = async (req, res) => {
  try {
    let { attachment_id } = req.params;
    let [deletedAttachments, errForDeletedAttachments] =
      await AttachmentHelper.deleteAttachments({
        attachment_ids: [attachment_id],
      });
    if (errForDeletedAttachments)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to remove attachment, please try again or contact support',
        error: errForDeletedAttachments,
      });
    return successResponse(res, 'Successfully removed attachment');
  } catch (err) {
    if (errForDeletedAttachments)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to remove attachment, please try again or contact support',
        error: err?.message,
      });
  }
};
/**
 * Download attachments
 * @param {*} req
 * @param {*} res
 * @returns signed url for private attachment
 */
const downloadAttachment = async (req, res) => {
  try {
    const { attachment_id } = req.params;
    // * Fetch attachment by Id
    let [attachment, errFetchingAttachment] = await Repository.fetchOne({
      tableName: DB_TABLES.ATTACHMENT,
      query: {
        attachment_id,
      },
      extras: {
        attributes: {
          exclude: ['created_at', 'updated_at'],
        },
      },
    });
    if (errFetchingAttachment)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to download attachment',
        error: `Error while fetching signed url for attachment: ${errFetchingAttachment}`,
      });
    if (!attachment)
      return notFoundResponseWithDevMsg({ res, msg: 'Attachment not found' });

    // * Fetch signed url for attachment
    const [signedUrl, errForSignedUrl] =
      await AttachmentHelper.getSignedUrlForAttachment(attachment);
    if (errForSignedUrl || !signedUrl)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to download attachment`,
        error: `Error while fetching signed url for attachment: ${errForSignedUrl}`,
      });

    return successResponse(
      res,
      `Fetched download link for attachment`,
      signedUrl
    );
  } catch (err) {
    logger.error(`Error while fetching signed url for attachment:`, {
      user_id: req.user.user_id,
      err,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching signed url for attachment: ${err.message}`,
    });
  }
};

const AttachmentsController = {
  getAttachmentById,
  deleteAttachmentOnRemove,
  downloadAttachment,
};

module.exports = AttachmentsController;

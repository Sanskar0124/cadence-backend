// Packages
const { nanoid } = require('nanoid');

// Utils
const logger = require('../../../utils/winston.js');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  IMAGE_FORMATS,
  ATTACHMENT_FORMATS,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

//Repository
const Repository = require('../../../../../Cadence-Brain/src/repository');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Helpers and Services
const Storage = require('../../../../../Cadence-Brain/src/services/Google/Storage');

const uploadImage = async (req, res) => {
  try {
    let originalFileName = req.file.originalname;
    let fileExtension = originalFileName.split('.').pop();

    if (!Object.values(IMAGE_FORMATS).includes(fileExtension))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Image format is not supported',
      });

    let fileName = nanoid();
    let finalFileName = fileName + '.' + fileExtension;

    const [fileData, err] = await Storage.Bucket.uploadImage(
      req.file.buffer,
      finalFileName
    );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to upload image',
        error: `Error while uploading image: ${err}`,
      });

    return successResponse(res, 'Uploaded image successfully.', fileData);
  } catch (error) {
    logger.error(`Error while fetching video data:`, error);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while uploading image: ${(res, error.message)}`,
    });
  }
};

const deleteImage = async (req, res) => {
  try {
    let deleteImagePromises = [];

    for (let file of req.body.data)
      deleteImagePromises.push(Storage.Bucket.deleteFile(file.name));

    const deleteImagePromisesResolved = await Promise.all(deleteImagePromises);

    deleteImagePromisesResolved.forEach(([_, errForDelete]) => {
      if (errForDelete) throw new Error(errForDelete);
    });

    return successResponse(res, `Images Deleted`);
  } catch (err) {
    logger.error(`Error while deleting image: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting image: ${err.message}`,
    });
  }
};

const uploadAttachment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!req.file) throw new Error('File not found');
    let originalFileName = req.file.originalname;
    let fileExtension = originalFileName.split('.').pop();

    if (!Object.values(ATTACHMENT_FORMATS).includes(fileExtension)) {
      await t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Attachment format is not supported',
      });
    }

    const [savedAttachment, errForSavedAttachment] = await Repository.create({
      tableName: DB_TABLES.ATTACHMENT,
      createObject: {
        original_name: originalFileName,
      },
      t,
    });
    if (errForSavedAttachment) {
      logger.error(`Error while creating attachment: `, {
        user_id: req.user.user_id,
        err: errForSavedAttachment,
      });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating attachment: ${errForSavedAttachment}`,
      });
    }

    const [_, errForUpload] = await Storage.Bucket.uploadAttachments(
      req.file.buffer,
      savedAttachment.attachment_id,
      originalFileName
    );
    if (errForUpload) {
      logger.error(`Error while uploading attachment: `, {
        user_id: req.user.user_id,
        err: errForUpload,
      });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while uploading attachment: ${errForUpload}`,
      });
    }
    const attachment_data = {
      attachment_id: savedAttachment.attachment_id,
      original_name: originalFileName,
    };

    await t.commit();
    return successResponse(
      res,
      'Uploaded image successfully.',
      attachment_data
    );
  } catch (error) {
    logger.error(`Error while uploading attachment:`, error);
    await t.rollback();
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while uploading attachment: ${error.message}`,
    });
  }
};

const GoogleController = {
  uploadImage,
  deleteImage,
  uploadAttachment,
};

module.exports = GoogleController;

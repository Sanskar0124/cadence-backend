// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');

// Repositories
const SignatureRepository = require('../../../../../../Cadence-Brain/src/repository/signature.repository');

const createUserSignature = async (req, res) => {
  try {
    let signature = req.body;
    signature.user_id = req.user.user_id;

    const [createdSignature, err] = await SignatureRepository.createSignature(
      signature
    );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create signature',
        error: `Error while creating signature: ${err}`,
      });

    return successResponse(
      res,
      'Signature created succesfully',
      createdSignature
    );
  } catch (err) {
    logger.error('Error while creating user signature: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating user signature: ${err.message}`,
    });
  }
};

const getSignatures = async (req, res) => {
  try {
    const [signatures, err] = await SignatureRepository.getAllSignatures(
      req.user.user_id
    );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch signatures',
        error: `Error while fetching signatures: ${err}`,
      });
    if (signatures.length === 0)
      return successResponse(res, 'No signatures present', []);

    return successResponse(res, 'Signatures fetched succesfully', signatures);
  } catch (err) {
    logger.error('Error while fetching signatures: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching signatures: ${err.message}`,
    });
  }
};

const updateUserSignature = async (req, res) => {
  try {
    const [updatedSignature, err] = await SignatureRepository.updateSignature(
      req.body
    );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update signature',
        error: `Error while updating signature: ${err}`,
      });

    return successResponse(res, 'Signature updated succesfully');
  } catch (err) {
    logger.error('Error while updating user signature: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating user signature: ${err.message}`,
    });
  }
};

const deleteUserSignature = async (req, res) => {
  try {
    const [_, err] = await SignatureRepository.deleteSignature({
      signature_id: req.params.id,
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete signature',
        error: `Error while deleting user signature: ${err}`,
      });

    return successResponse(res, 'Signature deleted succesfully');
  } catch (err) {
    logger.error('Error while deleting user signature: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting user signature: ${err.message}`,
    });
  }
};

const markSigantureAsPrimary = async (req, res) => {
  try {
    // mark existing primary as non-primary
    let [_, err] = await SignatureRepository.updateSignatures(
      {
        user_id: req.user.user_id,
        is_primary: true,
      },
      {
        is_primary: false,
      }
    );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to mark signature as primary',
        error: `Error while updating signature: ${err}`,
      });

    // update requested signature as primary
    const [data, errForUpdate] = await SignatureRepository.updateSignature({
      signature_id: parseInt(req.params.id),
      is_primary: true,
    });
    if (errForUpdate)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to mark signature as primary ',
        error: `Error while updating signature: ${errForUpdate}`,
      });

    logger.info(`Marked ${req.params.id} as primary.`);
    return successResponse(res, 'Marked signature as primary.');
  } catch (err) {
    logger.error('Error while marking new primary user signature: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while marking new primary user signature: ${err.message}`,
    });
  }
};

const MessageTemplateController = {
  createUserSignature,
  getSignatures,
  updateUserSignature,
  deleteUserSignature,
  markSigantureAsPrimary,
};

module.exports = MessageTemplateController;

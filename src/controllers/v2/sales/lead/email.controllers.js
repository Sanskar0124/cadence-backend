// TODO:[EMAIL] Make changes here

// Utils
const logger = require('../../../../utils/winston');
const {
  notFoundResponseWithDevMsg,
  successResponse,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');

// Repositories
const LeadEmailRepository = require('../../../../../../Cadence-Brain/src/repository/lead-em.repository');

// Joi
const emailSchema = require('../../../../joi/v2/sales/lead/email.joi');

const createEmail = async (req, res) => {
  try {
    const params = emailSchema.createEmailSchema.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    const { email_id, lead_id } = req.body;
    const [createdEmail, errForCreate] =
      await LeadEmailRepository.createAdditionalEmail(email_id, lead_id, false);
    if (errForCreate)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create email',
        error: `Error while creating additional email: ${errForCreate}`,
      });

    return successResponse(res, 'Email created successfully', createdEmail);
  } catch (err) {
    logger.error('Error while adding new email: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while adding new email: ${err.message}`,
    });
  }
};

const updateEmail = async (req, res) => {
  try {
    const params = emailSchema.updateEmailSchema.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    const { lem_id, email_id, is_primary, lead_id } = req.body;

    // If email is primary
    if (is_primary) {
      await LeadEmailRepository.updateLeadEmail(
        { lead_id },
        { is_primary: false }
      );

      const [updatedEmail, errForUpdate] =
        await LeadEmailRepository.updateLeadEmail(
          { lem_id, lead_id },
          { email_id, is_primary }
        );
      if (errForUpdate)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update email',
          error: `Error while updating lead email: ${errForUpdate}`,
        });

      return successResponse(res, 'Email updated successfully.');
    }

    const [updatedEmail, errForUpdate] =
      await LeadEmailRepository.updateLeadEmail(
        { lem_id, lead_id },
        { email_id }
      );
    if (errForUpdate)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update email',
        error: `Error while updating lead email: ${errForUpdate}`,
      });

    return successResponse(res, 'Email updated successfully.');
  } catch (err) {
    logger.error('Error while updating email: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating email: ${err.message}`,
    });
  }
};

const deleteEmail = async (req, res) => {
  try {
    const params = emailSchema.deleteEmailSchema.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    const { lem_id, lead_id } = req.body;

    const [fetchedEmail, errForFetch] =
      await LeadEmailRepository.fetchLeadEmailByQuery({ lem_id, lead_id });
    if (errForFetch)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete email',
        error: `Error while fetching lead email by query: ${errForFetch}`,
      });
    if (!fetchedEmail)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to delete email',
        error: 'Email not found',
      });

    if (fetchedEmail[0].is_primary === true)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Cannot delete primary email',
      });

    const [deleteEmail, errForDelete] =
      await LeadEmailRepository.deleteLeadEmail({ lem_id });
    if (errForDelete)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete email',
        error: `Error while deleting lead email: ${errForDelete}`,
      });

    return successResponse(res, 'Email deleted successfully.');
  } catch (err) {
    logger.error('Error while deleting email: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting email: ${err.message}`,
    });
  }
};

const LeadController = {
  createEmail,
  updateEmail,
  deleteEmail,
};

module.exports = LeadController;

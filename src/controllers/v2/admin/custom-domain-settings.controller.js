//Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  unprocessableEntityResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const { TRACKING_SERVER_URL } = require('../../../utils/config');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
//Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

//Helpers
const { retry } = require('../../../../../Cadence-Brain/src/helper/retry/');
const {
  resolveCname,
} = require('../../../../../Cadence-Brain/src/helper/dns/');

//Packages

//joi
const customDomainSettingsSchema = require('../../../joi/v2/admin/custom-domain-settings.joi');

const addCustomTrackingDomain = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const body = customDomainSettingsSchema.validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }
    // Remove leading and trailing white spaces
    const Custom_Domain_Settings = body.value;

    //Get User from Repository
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      t,
    });
    if (errForUser) throw new Error(errForUser);

    let createObject = {
      company_id: user.company_id,
      domain_name: Custom_Domain_Settings.domain_name?.trim(),
      domain_status: false,
    };
    //check DNS availablility of domain name
    const [domainNameAddresses, errForDomainNameAddresses] = await resolveCname(
      createObject
    );

    if (
      Array.isArray(domainNameAddresses?.addresses) &&
      !errForDomainNameAddresses
    )
      if (domainNameAddresses?.addresses?.includes(TRACKING_SERVER_URL))
        createObject.domain_status = true;

    const [createdCustomDomain, errForCreatedCustomDomain] =
      await Repository.create({
        tableName: DB_TABLES.CUSTOM_DOMAIN,
        createObject: createObject,
        t,
      });
    if (errForCreatedCustomDomain) throw new Error(errForCreatedCustomDomain);

    const [updatedCompanySettings, errForUpdatedCompanySettings] =
      await Repository.update({
        tableName: DB_TABLES.COMPANY_SETTINGS,
        updateObject: {
          custom_domain: true,
        },
        query: {
          company_id: user.company_id,
        },
        t,
      });
    if (errForUpdatedCompanySettings)
      throw new Error(errForUpdatedCompanySettings);

    t.commit();
    delete createObject.company_id;
    return successResponse(
      res,
      'Validating new domain. Please check again in 3-5 minutes',
      createObject
    );
  } catch (err) {
    t.rollback();
    logger.error('An error occurred while creating custom domain:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while adding custom tracking domain: ${err?.message}`,
    });
  }
};

const validateCustomTrackingDomain = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user?.user_id,
      },
      t,
    });

    if (errForUser) throw new Error(errForUser);

    //fetch custom domain of user's company
    const [customDomain, errForCustomDomain] = await Repository.fetchOne({
      tableName: DB_TABLES.CUSTOM_DOMAIN,
      query: {
        company_id: user.company_id,
      },
      extras: {
        attributes: ['domain_name', 'domain_status'],
      },
      t,
    });
    let cdObject = {
      domain_name: customDomain.domain_name,
      domain_status: customDomain.domain_status,
    };

    const [domainNameAddresses, errForDomainNameAddresses] = await resolveCname(
      cdObject
    );

    if (
      Array.isArray(domainNameAddresses?.addresses) &&
      !errForDomainNameAddresses
    )
      if (domainNameAddresses?.addresses?.includes(TRACKING_SERVER_URL))
        cdObject.domain_status = true;
      else cdObject.domain_status = false;
    else cdObject.domain_status = false;

    const [updatedCustomDomain, errForUpdatedCustomDomain] =
      await Repository.update({
        tableName: DB_TABLES.CUSTOM_DOMAIN,
        updateObject: cdObject,
        query: {
          company_id: user.company_id,
        },
        t,
      });
    if (errForUpdatedCustomDomain) throw new Error(errForUpdatedCustomDomain);

    await t.commit();
    if (!cdObject.domain_status)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Custom Domain has not been validated yet. Please try again later or contact support',
      });
    return successResponse(res, 'Validated Custom Domain Successfully');
  } catch (err) {
    await t.rollback();
    logger.error('An error occurred while validating custom domain:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while validating custom tracking domain: ${err?.message}`,
    });
  }
};

const updateCustomTrackingDomain = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const body = customDomainSettingsSchema.validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body?.error?.message,
      });
    }

    const Custom_Domain_Settings = body.value;
    //Get User from Repository
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      t,
    });
    if (errForUser) throw new Error(errForUser);

    let updateObject = {
      domain_name: Custom_Domain_Settings.domain_name,
      domain_status: false,
    };
    //check DNS availability of domain name
    const [domainNameAddresses, errForDomainNameAddresses] = await resolveCname(
      updateObject
    );
    if (
      Array.isArray(domainNameAddresses?.addresses) &&
      !errForDomainNameAddresses
    )
      if (domainNameAddresses?.addresses?.includes(TRACKING_SERVER_URL))
        updateObject.domain_status = true;
    const [updatedCustomDomain, errForUpdatedCustomDomain] =
      await Repository.update({
        tableName: DB_TABLES.CUSTOM_DOMAIN,
        updateObject: updateObject,
        query: {
          company_id: user.company_id,
        },
        t,
      });
    if (errForUpdatedCustomDomain) throw new Error(errForUpdatedCustomDomain);

    t.commit();
    return successResponse(
      res,
      'Updated Custom Domain Successfully',
      updateObject
    );
  } catch (err) {
    t.rollback();
    logger.error('An error occurred while updating custom domain:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating custom tracking domain: ${err?.message}`,
    });
  }
};

const deleteCustomTrackingDomain = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    //Get User from Repository
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      t,
    });
    if (errForUser) throw new Error(errForUser);
    const [deletedCustomDomain, errForDeletedCustomDomain] =
      await Repository.destroy({
        tableName: DB_TABLES.CUSTOM_DOMAIN,
        query: {
          company_id: user.company_id,
        },
        t,
      });
    if (errForDeletedCustomDomain) throw new Error(errForDeletedCustomDomain);

    const [updatedCompanySettings, errForUpdatedCompanySettings] =
      await Repository.update({
        tableName: DB_TABLES.COMPANY_SETTINGS,
        updateObject: {
          custom_domain: false,
        },
        query: {
          company_id: user.company_id,
        },
        t,
      });

    if (errForUpdatedCompanySettings)
      throw new Error(errForUpdatedCompanySettings);

    t.commit();
    return successResponse(
      res,
      'Deleted Custom Domain Successfully',
      deletedCustomDomain
    );
  } catch (err) {
    t.rollback();
    logger.error('An error occurred while deleting custom domain:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting custom tracking domain: ${err?.message}`,
    });
  }
};

module.exports = {
  addCustomTrackingDomain,
  updateCustomTrackingDomain,
  deleteCustomTrackingDomain,
  validateCustomTrackingDomain,
};

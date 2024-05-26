// Utils
const logger = require('../../../../utils/winston');
const {
  badRequestResponseWithDevMsg,
  successResponse,
  createdSuccessResponse,
  notFoundResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  unauthorizedResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const { FRONTEND_URL } = require('../../../../utils/config');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  SETTING_LEVELS,
  USER_ROLE,
  CADENCE_TYPES,
  ACTIVITY_TYPE,
  CRM_INTEGRATIONS,
  HIRING_INTEGRATIONS,
  USER_INTEGRATION_TYPES,
  USER_LANGUAGES,
  TEAM_CHANGE_OPTIONS,
  BULK_OPTIONS,
  CADENCE_ACTIONS,
  LEAD_INTEGRATION_TYPES,
  TRACKING_ACTIVITIES,
  TRACKING_REASONS,
  ONBOARDING_MAIL_STATUS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const { SALT_ROUNDS } = require('../../../../utils/config');

// Packages
const csv = require('fast-csv');
const fs = require('fs');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const axios = require('axios');

// Repository
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const UnsubscribeMailSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/unsubscribe-mail-settings.repository');
const BouncedMailSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/bounced-mail-settings.repository');
const AutomatedTaskSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/automated-task-settings.repository');
const TaskSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/task-settings.repository');

// Helpers and Services
const Storage = require('../../../../../../Cadence-Brain/src/services/Google/Storage');
const CryptoHelper = require('../../../../../../Cadence-Brain/src/helper/crypto');
const AmazonService = require('../../../../../../Cadence-Brain/src/services/Amazon');
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const HtmlHelper = require('../../../../../../Cadence-Brain/src/helper/html');
const UserTokensHelper = require('../../../../../../Cadence-Brain/src/helper/userTokens');
const UserHelper = require('../../../../../../Cadence-Brain/src/helper/user');
const RingoverHelper = require('../../../../../../Cadence-Brain/src/helper/ringover-service');
const CadenceHelper = require('../../../../../../Cadence-Brain/src/helper/cadence');
const OnboardingHelper = require('../../../../../../Cadence-Brain/src/helper/onboarding');
const TemplateHelper = require('../../../../../../Cadence-Brain/src/helper/template');
const LeadHelper = require('../../../../../../Cadence-Brain/src/helper/lead');
const GoogleSheetsHelper = require('../../../../../../Cadence-Brain/src/helper/google-sheets');
const SettingsHelpers = require('../../../../../../Cadence-Brain/src/helper/settings');

// Joi
const subDepartmentSchema = require('../../../../joi/v2/sales/sub-department/sub-department.joi');

// Other
const token = require('../../../v1/user/authentication/token');

const getAllEmployeesForManager = async (req, res) => {
  try {
    const [manager, errForManager] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: ['integration_type'],
        },
      },
    });
    if (errForManager)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users',
        error: `Error while fetching user: ${errForManager}`,
      });
    if (!manager)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'User does not exist',
        error: 'No user found',
      });

    const [users, errForUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: { sd_id: manager.sd_id },
      include: { [DB_TABLES.SUB_DEPARTMENT]: { attributes: ['name'] } },
      extras: {
        attributes: [
          'user_id',
          'sd_id',
          'first_name',
          'last_name',
          'profile_picture',
          'is_profile_picture_present',
        ],
      },
    });
    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users',
        error: `Error while fetching users: ${errForUsers}`,
      });

    return successResponse(
      res,
      `Users fetched successfully for sub-department.`,
      users
    );
  } catch (err) {
    logger.error(`Error while fetching users for manager: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching users for manager: ${err.message}`,
    });
  }
};

const getAllEmployeesForAdmin = async (req, res) => {
  try {
    const { sd_id } = req.params;
    if (!sd_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users',
        error: 'Sub department id is required',
      });

    const [admin, errForAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      include: {
        [DB_TABLES.COMPANY]: {
          [DB_TABLES.COMPANY_SETTINGS]: {},
        },
      },
    });
    if (errForAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users',
        error: `Error while fetching user: ${errForAdmin}`,
      });

    const [subDepartment, errForSubDepartment] = await Repository.fetchOne({
      tableName: DB_TABLES.SUB_DEPARTMENT,
      query: { sd_id },
      include: { [DB_TABLES.DEPARTMENT]: {} },
    });
    if (errForSubDepartment)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users',
        error: `Error while fetching sub department: ${errForSubDepartment}`,
      });
    if (!subDepartment)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Selected group does not exist',
      });

    let companySettings = admin?.Company?.Company_Setting;

    // Check if the user is fetch a team from their own company
    if (subDepartment?.Department?.company_id !== admin.company_id)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Selected group does not exist',
      });

    let tokensToFetch;

    switch (admin?.Company?.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        tokensToFetch = DB_TABLES.SALESFORCE_TOKENS;
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        tokensToFetch = DB_TABLES.PIPEDRIVE_TOKENS;
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        tokensToFetch = DB_TABLES.HUBSPOT_TOKENS;
        break;
      case CRM_INTEGRATIONS.ZOHO:
        tokensToFetch = DB_TABLES.ZOHO_TOKENS;
        break;
      case CRM_INTEGRATIONS.SELLSY:
        tokensToFetch = DB_TABLES.SELLSY_TOKENS;
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        tokensToFetch = DB_TABLES.BULLHORN_TOKENS;
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        tokensToFetch = DB_TABLES.DYNAMICS_TOKENS;
        break;
      default:
        tokensToFetch = '';
    }

    const [users, errForUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: { sd_id: sd_id },
      include: {
        [DB_TABLES.SUB_DEPARTMENT]: { attributes: ['name'] },
        [tokensToFetch]: {
          attributes: [
            'is_logged_out',
            //'encrypted_instance_url',
            //'instance_url',
          ],
        },
        [DB_TABLES.USER_TOKEN]: {
          attributes: [
            'encrypted_ringover_api_key',
            'ringover_api_key',
            //'is_salesforce_logged_out',
            'is_google_token_expired',
            'is_outlook_token_expired',
          ],
        },
        // [DB_TABLES.RINGOVER_TOKENS]: {
        //   attributes: [
        //     [
        //       sequelize.literal(
        //         'CASE WHEN ringover_token_id is NULL THEN 0 ELSE 1 END'
        //       ),
        //       'is_connected',
        //     ],
        //   ],
        // },
      },
      extras: {
        attributes: [
          'user_id',
          'sd_id',
          'first_name',
          'last_name',
          'profile_picture',
          'is_profile_picture_present',
          'email',
          'role',
          'salesforce_owner_id',
          'integration_id',
          'ringover_user_id',
          // [
          //   sequelize.literal('CASE WHEN password is NULL THEN 0 ELSE 1 END'),
          //   'has_accepted',
          // ],
        ],
      },
    });
    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users',
        error: `Error while fetching users: ${errForUsers}`,
      });

    // remove encrypted ringover api key
    users.forEach(
      (user) => delete user?.User_Token?.encrypted_ringover_api_key
    );

    return successResponse(
      res,
      'Users fetched successfully for sub-department.',
      { users, companySettings, subDepartment }
    );
  } catch (err) {
    logger.error(`Error while fetching users for admin: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching users for admin: ${err.message}`,
    });
  }
};

const getAllAdminsForAdmin = async (req, res) => {
  try {
    const [admin, errForAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      include: { [DB_TABLES.COMPANY]: { [DB_TABLES.COMPANY_SETTINGS]: {} } },
    });
    if (errForAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch admins',
        error: `Error while fetching user: ${errForAdmin}`,
      });

    let tokensToFetch;

    switch (admin?.Company?.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        tokensToFetch = DB_TABLES.SALESFORCE_TOKENS;
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        tokensToFetch = DB_TABLES.PIPEDRIVE_TOKENS;
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        tokensToFetch = DB_TABLES.HUBSPOT_TOKENS;
        break;
      case CRM_INTEGRATIONS.ZOHO:
        tokensToFetch = DB_TABLES.ZOHO_TOKENS;
        break;
      case CRM_INTEGRATIONS.SELLSY:
        tokensToFetch = DB_TABLES.SELLSY_TOKENS;
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        tokensToFetch = DB_TABLES.BULLHORN_TOKENS;
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        tokensToFetch = DB_TABLES.DYNAMICS_TOKENS;
        break;
      default:
        tokensToFetch = '';
    }

    console.log('Fetching...');
    const [allAdmins, errForAdmins] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: {
        role: {
          [Op.or]: [USER_ROLE.ADMIN, USER_ROLE.SUPER_ADMIN],
        },
        company_id: admin.company_id,
      },
      include: {
        [DB_TABLES.USER_TOKEN]: {
          attributes: [
            'encrypted_ringover_api_key',
            'ringover_api_key',
            'is_salesforce_logged_out',
            'is_google_token_expired',
            'is_outlook_token_expired',
          ],
        },
        [tokensToFetch]: { attributes: ['is_logged_out', 'instance_url'] },
      },
      extras: {
        attributes: [
          'user_id',
          'sd_id',
          'first_name',
          'last_name',
          'profile_picture',
          'is_profile_picture_present',
          'email',
          'role',
          'salesforce_owner_id',
          'integration_id',
          'ringover_user_id',
        ],
      },
    });
    if (errForAdmins)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch admins',
        error: `Error while fetching users: ${errForAdmins}`,
      });

    let companySettings = admin?.Company?.Company_Setting;

    return successResponse(res, `Admins fetched successfully.`, {
      users: allAdmins,
      companySettings,
    });
  } catch (err) {
    logger.error(`Error while fetching users for admin: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      errror: `Error while fetching users for admin: ${err.message}`,
    });
  }
};

const createSubDepartment = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const sdParams = subDepartmentSchema.subDepartmentCreateSchema.validate({
      name: req.fields?.name,
      department_id: req.fields?.department_id,
    });
    if (sdParams.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: sdParams.error.message,
      });
    }

    // Check duplicate subdepartment

    const [duplicateSubDepartment, errForDuplicateSubDepartment] =
      await Repository.fetchOne({
        tableName: DB_TABLES.SUB_DEPARTMENT,
        query: {
          department_id: req.fields.department_id,
          name: req.fields.name,
        },
      });
    if (errForDuplicateSubDepartment) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create new group',
        error: `Error while checking if sub department already exist: ${errForDuplicateSubDepartment}`,
      });
    }

    if (duplicateSubDepartment)
      return badRequestResponseWithDevMsg({
        res,
        msg: `A group with this name already exists`,
      });

    const [subDepartment, errForSubDepartment] = await Repository.create({
      tableName: DB_TABLES.SUB_DEPARTMENT,
      createObject: {
        name: req.fields.name,
        department_id: req.fields.department_id,
        is_profile_picture_present:
          Object.keys(req.files).length > 0 ? true : false,
      },
      t,
    });
    if (errForSubDepartment) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create new group',
        error: `Error while creating new sub department: ${errForSubDepartment}`,
      });
    }

    const [subDepartmentSettings, errForSubDepartmentSetting] =
      await Repository.create({
        tableName: DB_TABLES.SUB_DEPARTMENT_SETTINGS,
        createObject: {
          sd_id: subDepartment.sd_id,
        },
        t,
      });
    if (errForSubDepartmentSetting) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create new group',
        error: `Error while creating sub department settings: ${errForSubDepartmentSetting}`,
      });
    }

    if (Object.keys(req.files).length > 0) {
      const buffer = fs.readFileSync(req.files.image.path);
      var [url, err] = await Storage.Bucket.uploadSubdepartmentProfilePicture(
        buffer,
        subDepartment.sd_id
      );
      console.log(url, err);
      if (err) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create new group',
          error: `Error while uploading sub department profile picture: ${err}`,
        });
      }
    }

    t.commit();

    return createdSuccessResponse(
      res,
      'Sub department created successfully.',
      subDepartment
    );
  } catch (err) {
    t.rollback();
    logger.error(`Error while creating sub department: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating sub department: ${err.message}`,
    });
  }
};

const updateSubDepartment = async (req, res) => {
  try {
    // Pass name and department id in req body
    let body = subDepartmentSchema.subDepartmentUpdateSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // Check if a group with same name already exists for the company
    const [duplicateSD, errDuplicateSD] = await Repository.fetchOne({
      tableName: DB_TABLES.SUB_DEPARTMENT,
      query: {
        department_id: body.department_id,
        name: body.name,
      },
    });
    if (errDuplicateSD)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update group',
        error: `Error while checking duplicate sub department: ${errDuplicateSD}`,
      });
    if (duplicateSD)
      return badRequestResponseWithDevMsg({
        res,
        msg: `A group with this name already exists`,
      });

    delete body.department_id;

    const [, errUpdateSD] = await Repository.update({
      tableName: DB_TABLES.SUB_DEPARTMENT,
      query: {
        sd_id: req.params.sd_id,
      },
      updateObject: body,
    });
    if (errUpdateSD)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update group',
        error: `Error while updating sub department: ${errUpdateSD}`,
      });

    return successResponse(res, 'Group updated successfully.');
  } catch (err) {
    logger.error(`Error while updating group: ${err.message}`);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating group: ${err.message}`,
    });
  }
};

const fetchAllSubDepartmentsForCompany = async (req, res) => {
  try {
    const [user, userErr] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (userErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch groups',
        error: `Error while fetching user: ${userErr}`,
      });

    const [subDepartments, err] = await Repository.fetchAll({
      tableName: DB_TABLES.SUB_DEPARTMENT,
      query: { department_id: user.department_id },
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch groups',
        error: `Error while fetching sub departments: ${err}`,
      });
    if (subDepartments.length === 0)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Selected group does not exist',
      });

    return successResponse(res, 'Fetched all sub-departments.', subDepartments);
  } catch (err) {
    logger.error(`Error while fetching all sub departments: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching all sub departments: ${err.message}`,
    });
  }
};

const fetchAllSubDepartmentsForCompanyWithUsersAndAdmins = async (req, res) => {
  try {
    const [user, userErr] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (userErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch groups',
        error: `Error while fetching user: ${userErr}`,
      });

    const [subDepartments, err] = await Repository.fetchAll({
      tableName: DB_TABLES.SUB_DEPARTMENT,
      query: { department_id: user.department_id },
      include: {
        [DB_TABLES.USER]: {
          attributes: [
            'user_id',
            'profile_picture',
            'is_profile_picture_present',
          ],
        },
      },
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch groups',
        error: `Error while fetching sub departments: ${err}`,
      });

    const [allAdmins, errForAdmins] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: {
        role: {
          [Op.or]: [USER_ROLE.ADMIN, USER_ROLE.SUPER_ADMIN],
        },
        company_id: user.company_id,
      },
      extras: {
        attributes: [
          'user_id',
          'profile_picture',
          'is_profile_picture_present',
        ],
      },
    });
    if (errForAdmins)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch groups',
        error: `Error while fetching users: ${errForAdmins}`,
      });

    return successResponse(res, 'Fetched all sub-departments.', {
      subDepartments,
      allAdmins,
    });
  } catch (err) {
    logger.error(`Error while fetching all sub departments: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching all sub departments: ${err.message}`,
    });
  }
};

const deleteSubDepartment = async (req, res) => {
  try {
    const { sd_id } = req.params;

    if (sd_id == null || sd_id === '')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to delete group',
        error: 'Team id cannot be empty',
      });

    const [admin, errForAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (errForAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete group',
        error: `Error while fetching user`,
      });
    if (!admin)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'User does not exist',
        error: `Error while fetching user`,
      });

    const [subDepartment, errForSubDepartment] = await Repository.fetchOne({
      tableName: DB_TABLES.SUB_DEPARTMENT,
      query: { sd_id },
      include: { [DB_TABLES.DEPARTMENT]: {}, [DB_TABLES.USER]: {} },
    });
    if (errForSubDepartment)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete group',
        error: `Error while fetching sub department: ${errForSubDepartment}`,
      });
    if (!subDepartment)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected group does not exist',
        error: 'Team not found',
      });

    if (subDepartment.name === 'Admin')
      return badRequestResponseWithDevMsg({
        res,
        msg: `You cannot delete a admin group`,
      });

    // The user should not be able to delete another company's sub department
    if (subDepartment?.Department?.company_id !== admin.company_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected group does not exist',
      });

    if (subDepartment?.Users?.length > 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You cannot delete a group with users present',
      });

    await Repository.destroy({
      tableName: DB_TABLES.SUB_DEPARTMENT,
      query: { sd_id },
    });

    return successResponse(res, 'Deleted team successfully.');
  } catch (err) {
    logger.error(`Error while deleting sub department: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting sub department: ${err.message}`,
    });
  }
};

const addUsersToSubDepartmentViaCSV = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    let users = [];

    csv
      .parseFile(req.file.path)
      .on('data', (data) => {
        users.push({
          first_name: data[0],
          last_name: data[1],
          email: data[2],
          ringover_user_id: data[3],
          ringover_api_key: data[4],
          salesforce_owner_id: data[5],
          role: data[6],
          timezone: data[7],
        });
      })
      .on('end', async () => {
        users.shift();
        if (users.length > 20) {
          t.rollback();
          return badRequestResponseWithDevMsg({
            res,
            msg: '20 or more users cannot be added at a time',
          });
        }

        const params =
          subDepartmentSchema.subDepartmentUsersSchema.validate(users);
        if (params.error) {
          t.rollback();
          return unprocessableEntityResponseWithDevMsg({
            res,
            error: params.error.message,
          });
        }

        const [admin, errForAdmin] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          include: {
            [DB_TABLES.COMPANY]: {
              attributes: ['number_of_licences'],
              [DB_TABLES.USER]: {
                attributes: [[sequelize.literal('COUNT(*)'), 'user_count']],
              },
            },
          },
          //extras: { attributes: [] },
          t,
        });
        if (errForAdmin) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add users to group via csv',
            error: `Error while fetching user: ${errForAdmin}`,
          });
        }

        if (
          admin?.Company?.Users?.[0]?.user_count + users.length >
          admin?.Company?.number_of_licences
        ) {
          t.rollback();
          return badRequestResponseWithDevMsg({
            res,
            msg: `Please purchase additional licences to add more users`,
          });
        }

        const [subDepartment, errForSubDepartment] = await Repository.fetchOne({
          tableName: DB_TABLES.SUB_DEPARTMENT,
          query: { sd_id: req.body.sd_id },
          include: {
            [DB_TABLES.DEPARTMENT]: {},
            [DB_TABLES.SUB_DEPARTMENT_SETTINGS]: {},
          },
          t,
        });
        if (errForSubDepartment) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add users to group via csv',
            error: `Error while fetching sub department: ${errForSubDepartment}`,
          });
        }
        if (!subDepartment) {
          t.rollback();
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Selected group does not exist',
          });
        }

        let unsubscribe_company_settings,
          bounced_company_settings,
          automated_company_settings,
          task_company_settings,
          skip_company_settings,
          lead_score_company_settings,
          automated_task_setting_priority = SETTING_LEVELS.SUB_DEPARTMENT,
          bounced_setting_priority = SETTING_LEVELS.SUB_DEPARTMENT,
          unsubscribe_setting_priority = SETTING_LEVELS.SUB_DEPARTMENT,
          task_setting_priority = SETTING_LEVELS.SUB_DEPARTMENT,
          skip_setting_priority = SETTING_LEVELS.SUB_DEPARTMENT,
          ls_setting_priority = SETTING_LEVELS.SUB_DEPARTMENT,
          error;

        let company_id = subDepartment.Department.company_id;

        [unsubscribe_company_settings, error] =
          await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
            {
              sd_id: req.body.sd_id,
              priority: SETTING_LEVELS.SUB_DEPARTMENT,
            }
          );
        if (!unsubscribe_company_settings) {
          unsubscribe_setting_priority = SETTING_LEVELS.ADMIN;
          unsubscribe_company_settings =
            await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
              {
                company_id,
                priority: SETTING_LEVELS.ADMIN,
              }
            );
        }

        [bounced_company_settings, error] =
          await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
            sd_id: req.body.sd_id,
            priority: SETTING_LEVELS.SUB_DEPARTMENT,
          });
        if (!bounced_company_settings) {
          bounced_setting_priority = SETTING_LEVELS.ADMIN;
          bounced_company_settings =
            await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
              company_id,
              priority: SETTING_LEVELS.ADMIN,
            });
        }

        [automated_company_settings, error] =
          await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
            sd_id: req.body.sd_id,
            priority: SETTING_LEVELS.SUB_DEPARTMENT,
          });
        if (!automated_company_settings) {
          automated_task_setting_priority = SETTING_LEVELS.ADMIN;
          automated_company_settings =
            await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery(
              {
                company_id,
                priority: SETTING_LEVELS.ADMIN,
              }
            );
        }

        [task_company_settings, error] =
          await TaskSettingsRepository.getTaskSettingByQuery({
            sd_id: req.body.sd_id,
            priority: SETTING_LEVELS.SUB_DEPARTMENT,
          });
        if (!task_company_settings) {
          task_setting_priority = SETTING_LEVELS.ADMIN;
          task_company_settings =
            await TaskSettingsRepository.getTaskSettingByQuery({
              company_id,
              priority: SETTING_LEVELS.ADMIN,
            });
        }

        [skip_company_settings, error] = await Repository.fetchOne({
          tableName: DB_TABLES.SKIP_SETTINGS,
          query: {
            sd_id: req.body.sd_id,
            priority: SETTING_LEVELS.SUB_DEPARTMENT,
          },
        });
        if (!skip_company_settings) {
          skip_setting_priority = SETTING_LEVELS.ADMIN;
          await Repository.fetchOne({
            tableName: DB_TABLES.SKIP_SETTINGS,
            query: {
              sd_id: req.body.sd_id,
              priority: SETTING_LEVELS.ADMIN,
            },
          });
        }

        [lead_score_company_settings, error] = await Repository.fetchOne({
          tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
          query: {
            sd_id: req.body.sd_id,
            priority: SETTING_LEVELS.SUB_DEPARTMENT,
          },
        });
        if (!lead_score_company_settings) {
          ls_setting_priority = SETTING_LEVELS.ADMIN;
          await Repository.fetchOne({
            tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
            query: {
              sd_id: req.body.sd_id,
              priority: SETTING_LEVELS.ADMIN,
            },
          });
        }

        if (error) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add users to group via csv',
            error: `Error while fetching task settings by query: ${error}`,
          });
        }

        users.forEach((user) => {
          user.is_profile_picture_present = false;
          user.smart_action_type = [];
          user.sd_id = subDepartment.sd_id;
          user.department_id = subDepartment?.department_id;
          user.company_id = subDepartment?.Department?.company_id;
          user.create_agendas_from_custom_task = 1;
          if (user.ringover_user_id === '') user.ringover_user_id = null;
        });

        const [createdUsers, errForUsers] = await Repository.bulkCreate({
          tableName: DB_TABLES.USER,
          createObject: users,
          t,
        });
        if (errForUsers) {
          t.rollback();
          if (errForUsers.includes('must be unique'))
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to add users to group via csv',
              error: `Error while creating users: ${errForUsers}`,
            });
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add users to group via csv',
            error: `Error while creating users in bulk: ${errForUsers}`,
          });
        }

        const sdSettings = subDepartment.Sub_Department_Setting;

        let userTokens = [];
        for (let user of createdUsers) {
          let currentUser = users.filter((u) => u.email === user.email);
          if (currentUser[0].ringover_api_key != null) {
            const [encryptedRingoverApiKey, errForEncryptedRingoverApiKey] =
              CryptoHelper.encrypt(currentUser[0].ringover_api_key);
            userTokens.push({
              user_id: user.user_id,
              encrypted_ringover_api_key: encryptedRingoverApiKey,
              lusha_service_enabled: sdSettings.enable_new_users_lusha ?? false,
              kaspr_service_enabled: sdSettings.enable_new_users_kaspr ?? false,
            });
          } else {
            userTokens.push({
              user_id: user.user_id,
              lusha_service_enabled: sdSettings.enable_new_users_lusha ?? false,
              kaspr_service_enabled: sdSettings.enable_new_users_kaspr ?? false,
            });
          }
        }

        let settings = [];

        for (let user of createdUsers) {
          settings.push({
            user_id: user.user_id,
            automated_task_setting_priority,
            unsubscribe_setting_priority,
            bounced_setting_priority,
            task_setting_priority,
            skip_setting_priority,
            ls_setting_priority,
            at_settings_id: automated_company_settings.at_settings_id,
            unsubscribe_settings_id:
              unsubscribe_company_settings.unsubscribe_settings_id,
            bounced_settings_id: bounced_company_settings.bounced_settings_id,
            task_settings_id: task_company_settings.task_settings_id,
            skip_settings_id: skip_company_settings.skip_settings_id,
            ls_settings_id: lead_score_company_settings.ls_settings_id,
          });
        }

        const [userToken, errForUserToken] = await Repository.bulkCreate({
          tableName: DB_TABLES.USER_TOKEN,
          createObject: userTokens,
          t,
        });
        if (errForUserToken) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add users to group via csv',
            error: `Error while creating user tokens in bulk: ${errForUserToken}`,
          });
        }

        for (let user of createdUsers) {
          const userToken = token.generateToken({
            user_id: user.user_id,
          });

          const [mail, err] = await AmazonService.sendHtmlMails({
            subject: OnboardingHelper.getSubjectForProductTourCadence({
              language: user?.language,
            }),
            body: HtmlHelper.inviteMail({
              url: `${FRONTEND_URL}/crm/welcome`,
              user_first_name: user?.first_name || '',
              inviting_user_first_name: req.user?.first_name || '',
              language: user?.language,
            }),
            emailsToSend: [user.email],
            tracking: true,
          });
          if (err) {
            t.rollback();
            if (err.includes('Sending paused for this account.'))
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'There is an issue with sending mails. Please try again after sometime or contact support',
                error: `Error while sending mail: ${err}`,
              });
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to add users to group via csv',
              error: `Error while sending mail: ${err}`,
            });
          }

          await Repository.update({
            tableName: DB_TABLES.USER_TOKEN,
            query: { user_id: user?.user_id },
            updateObject: {
              onboarding_mail_message_id: mail?.MessageId,
              onboarding_mail_status: ONBOARDING_MAIL_STATUS.PROCESSING,
            },
            t,
          });
        }

        const [createdSettings, errForSettings] = await Repository.bulkCreate({
          tableName: DB_TABLES.SETTINGS,
          createObject: settings,
          t,
        });
        if (errForSettings) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add users to group via csv',
            error: `Error for creating settings in bulk: ${errForSettings}`,
          });
        }

        for (let createdSetting of createdSettings) {
          const [updatedUser, errForUpdatedUser] = await Repository.update({
            tableName: DB_TABLES.USER,
            updateObject: { settings_id: createdSetting.settings_id },
            query: { user_id: createdSetting.user_id },
            t,
          });
          if (errForUpdatedUser) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to add users to group via csv',
              error: `Error while updating user: ${errForUpdatedUser}`,
            });
          }
        }

        t.commit();

        return createdSuccessResponse(res, 'Users created successfully.');
      });
  } catch (err) {
    t.rollback();
    logger.error(`Error while adding multiple users sub department: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while adding multiple users in sub department: ${err.message}`,
    });
  }
};

const addUserToSubDepartment = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const params = subDepartmentSchema.subDepartmentUserSchema.validate(
      req.body
    );
    if (params.error) {
      t.rollback();

      if (params.error.message.includes('"ringover_user_id" must be a number'))
        return unprocessableEntityResponseWithDevMsg({
          res,
          msg: 'Ringover User ID is not correct',
          error: 'Make sure your User ID is an integer',
        });

      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    // * Process Ringover User ID
    // if (req.body.ringover_user_id) {
    //   if (req.body.ringover_user_id <= 10000)
    //     return badRequestResponseWithDevMsg({
    //       res,
    //       msg: 'Ringover User ID is not correct',
    //     });

    //   // * Subtract 10000
    //   req.body.ringover_user_id = req.body.ringover_user_id - 10000;
    // }

    const [user, errForFetchUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: ['number_of_licences', 'integration_type'],
          [DB_TABLES.USER]: {
            attributes: [[sequelize.literal('COUNT(*)'), 'user_count']],
          },
        },
      },
      t,
    });
    if (errForFetchUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add user to sub department',
        error: `Error while fetching user: ${errForFetchUser}`,
      });
    }

    req.body.email = req.body.email.toLowerCase();

    if (
      user?.Company?.Users?.[0]?.user_count + 1 >
      user?.Company?.number_of_licences
    )
      return badRequestResponseWithDevMsg({
        res,
        msg: `Please purchase additional licences to add more users`,
      });

    let integration_type;
    let tokenToCreate;
    if (user?.Company?.integration_type)
      switch (user?.Company?.integration_type) {
        case CRM_INTEGRATIONS.SALESFORCE:
          integration_type = USER_INTEGRATION_TYPES.SALESFORCE_OWNER;
          tokenToCreate = DB_TABLES.SALESFORCE_TOKENS;
          break;
        case CRM_INTEGRATIONS.PIPEDRIVE:
          integration_type = USER_INTEGRATION_TYPES.PIPEDRIVE_USER;
          tokenToCreate = DB_TABLES.PIPEDRIVE_TOKENS;
          break;
        case CRM_INTEGRATIONS.SHEETS:
          integration_type = USER_INTEGRATION_TYPES.SHEETS_USER;
          tokenToCreate = null;
          break;
        case CRM_INTEGRATIONS.HUBSPOT:
          integration_type = USER_INTEGRATION_TYPES.HUBSPOT_OWNER;
          tokenToCreate = DB_TABLES.HUBSPOT_TOKENS;
          break;
        case CRM_INTEGRATIONS.ZOHO:
          integration_type = USER_INTEGRATION_TYPES.ZOHO_USER;
          tokenToCreate = DB_TABLES.ZOHO_TOKENS;
          break;
        case CRM_INTEGRATIONS.SELLSY:
          integration_type = USER_INTEGRATION_TYPES.SELLSY_OWNER;
          tokenToCreate = DB_TABLES.SELLSY_TOKENS;
          break;
        case HIRING_INTEGRATIONS.BULLHORN:
          integration_type = USER_INTEGRATION_TYPES.BULLHORN_USER;
          tokenToCreate = DB_TABLES.BULLHORN_TOKENS;
          break;
        case CRM_INTEGRATIONS.DYNAMICS:
          integration_type = USER_INTEGRATION_TYPES.DYNAMICS_OWNER;
          tokenToCreate = DB_TABLES.DYNAMICS_TOKENS;
          break;
        default:
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Company does not have a valid integration type. Please try again later or contact support',
          });
      }
    if (
      [
        CRM_INTEGRATIONS.HUBSPOT,
        CRM_INTEGRATIONS.SELLSY,
        HIRING_INTEGRATIONS.BULLHORN,
      ].includes(user?.Company?.integration_type)
    ) {
      const [checkUser, errForCheckUser] = await Repository.count({
        tableName: DB_TABLES.USER,
        query: {
          first_name: req.body.first_name,
          last_name: req.body.last_name,
          company_id: user.company_id,
        },
        t,
      });
      if (errForCheckUser) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to add user to sub department',
          error: `Error for checking user:  ${errForCheckUser}`,
        });
      }
      console.log(checkUser);
      if (checkUser) {
        t.rollback();
        return badRequestResponseWithDevMsg({
          res,
          msg: `User with same name already exist in ${user?.Company?.integration_type}`,
        });
      }
    }

    if (req.body.role === USER_ROLE.ADMIN) {
      let userObject = {
        ...req.body,
        department_id: user.department_id,
        company_id: user.company_id,
        create_agendas_from_custom_task: 1,
        integration_type,
      };
      delete userObject.ringover_api_key;
      if (integration_type == USER_INTEGRATION_TYPES.SHEETS_USER)
        userObject.integration_id = `S${new Date().getTime()}`;
      const [adminSubDepartment, errForAdminSubDepartment] =
        await Repository.fetchOne({
          tableName: DB_TABLES.SUB_DEPARTMENT,
          query: {
            department_id: user.department_id,
            name: `Admin`,
          },
        });
      if (errForAdminSubDepartment) {
        t.rollback();
        logger.error(
          `Error while fetching Admins subdepartment`,
          errForAdminSubDepartment
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to add user to sub department',
          error: `Error while fetching sub department: ${errForAdminSubDepartment}`,
        });
      }

      userObject.sd_id = adminSubDepartment.sd_id;

      const [createdUser, errForUser] = await Repository.create({
        tableName: DB_TABLES.USER,
        createObject: userObject,
        t,
      });
      if (errForUser) {
        t.rollback();
        if (errForUser.includes('must be unique'))
          return badRequestResponseWithDevMsg({
            res,
            error: `Error while creating user: ${errForUser}`,
          });
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to add user to sub department',
          error: `Error while fetching user: ${errForUser}`,
        });
      }
      const [profileUrl, errForProfileUrl] = await UserHelper.createAvatar({
        user_id: createdUser.user_id,
        first_name: createdUser.first_name,
        last_name: createdUser.last_name,
      });
      logger.error('Error creating avatar', errForProfileUrl);

      if (req.body.ringover_api_key != null) {
        const [encryptedRingoverApiKey, errForEncryptedRingoverApiKey] =
          CryptoHelper.encrypt(req.body.ringover_api_key);

        const [userToken, errForUserToken] = await Repository.create({
          tableName: DB_TABLES.USER_TOKEN,
          createObject: {
            encrypted_ringover_api_key: encryptedRingoverApiKey,
            user_id: createdUser.user_id,
            lusha_service_enabled: false,
            kaspr_service_enabled: false,
          },
          t,
        });
        if (errForUserToken) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add user to sub department',
            error: `Error while creating user token: ${errForUserToken}`,
          });
        }
      } else {
        const [userToken, errForUserToken] = await Repository.create({
          tableName: DB_TABLES.USER_TOKEN,
          createObject: {
            user_id: createdUser.user_id,
            lusha_service_enabled: false,
            kaspr_service_enabled: false,
          },
          t,
        });
        if (errForUserToken) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add user to sub department',
            error: `Error while creating user token: ${errForUserToken}`,
          });
        }
      }

      const [UnsubscribeCompanySettings, errForUnsubscribeSettings] =
        await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
          {
            company_id: user.company_id,
            priority: SETTING_LEVELS.ADMIN,
          }
        );

      const [bouncedCompanySettings, errForBouncedSetting] =
        await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
          company_id: user.company_id,
          priority: SETTING_LEVELS.ADMIN,
        });

      const [AutomatedCompanySettings, errForAutomatedSettings] =
        await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
          company_id: user.company_id,
          priority: SETTING_LEVELS.ADMIN,
        });

      const [TaskCompanySettings, errForTaskSettings] =
        await TaskSettingsRepository.getTaskSettingByQuery({
          company_id: user.company_id,
          priority: SETTING_LEVELS.ADMIN,
        });

      const [SkipCompanySettings, errForSkipSettings] =
        await Repository.fetchOne({
          tableName: DB_TABLES.SKIP_SETTINGS,
          query: {
            company_id: user.company_id,
            priority: SETTING_LEVELS.ADMIN,
          },
        });

      const [LeadScoreCompanySettings, errForLeadScoreSettings] =
        await Repository.fetchOne({
          tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
          query: {
            company_id: user.company_id,
            priority: SETTING_LEVELS.ADMIN,
          },
        });

      if (
        errForUnsubscribeSettings ||
        errForAutomatedSettings ||
        errForBouncedSetting ||
        errForTaskSettings
      ) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to add user to sub department',
          error: `${
            errForUnsubscribeSettings ||
            errForAutomatedSettings ||
            errForBouncedSetting ||
            errForTaskSettings ||
            errForSkipSettings ||
            errForLeadScoreSettings
          }`,
        });
      }

      const [createdSetting, errForCreatedSetting] = await Repository.create({
        tableName: DB_TABLES.SETTINGS,
        createObject: {
          user_id: createdUser.user_id,
          automated_task_setting_priority: SETTING_LEVELS.ADMIN,
          unsubscribe_setting_priority: SETTING_LEVELS.ADMIN,
          bounced_setting_priority: SETTING_LEVELS.ADMIN,
          task_setting_priority: SETTING_LEVELS.ADMIN,
          skip_setting_priority: SETTING_LEVELS.ADMIN,
          ls_setting_priority: SETTING_LEVELS.ADMIN,
          at_settings_id: AutomatedCompanySettings.at_settings_id,
          unsubscribe_settings_id:
            UnsubscribeCompanySettings.unsubscribe_settings_id,
          bounced_settings_id: bouncedCompanySettings.bounced_settings_id,
          task_settings_id: TaskCompanySettings.task_settings_id,
          skip_settings_id: SkipCompanySettings.skip_settings_id,
          ls_settings_id: LeadScoreCompanySettings?.ls_settings_id,
        },
        t,
      });
      if (errForCreatedSetting) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to add user to sub department',
          error: `Error while creating settings: ${errForCreatedSetting}`,
        });
      }

      const [userTask, errForUserTask] = await Repository.create({
        tableName: DB_TABLES.USER_TASK,
        createObject: { user_id: createdUser.user_id },
        t,
      });
      if (errForUserTask) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to add user to sub department',
          error: `Error while creating user task: ${errForUserTask}`,
        });
      }

      // update user table with settings_id
      const [updatedUser, errForUpdatedUser] = await Repository.update({
        tableName: DB_TABLES.USER,
        updateObject: { settings_id: createdSetting.settings_id },
        query: { user_id: createdUser.user_id },
        t,
      });
      if (errForUpdatedUser) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to add user to sub department',
          error: `Error while updating user: ${errForUpdatedUser}`,
        });
      }

      if (tokenToCreate) {
        if (user?.Company?.integration_type === CRM_INTEGRATIONS.DYNAMICS) {
          const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
            tableName: DB_TABLES.COMPANY,
            query: {
              company_id: req.user.company_id,
            },
            include: {
              [DB_TABLES.COMPANY_SETTINGS]: {
                attributes: ['user_id'],
              },
            },
            extras: {
              attributes: ['company_id'],
            },
          });
          if (errCrmAdmin) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Could not find CRM admin',
              error: errCrmAdmin,
            });
          }
          const [tokens, errForTokens] = await Repository.fetchOne({
            tableName: DB_TABLES.DYNAMICS_TOKENS,
            query: {
              user_id: crmAdmin?.Company_Setting?.user_id,
            },
            extras: {
              attributes: ['encrypted_instance_url'],
            },
          });
          if (errForTokens) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to add user to sub department',
              error: `Error while fetching user: ${errForTokens}`,
            });
          }
          const [crmToken, errForCrmToken] = await Repository.create({
            tableName: tokenToCreate,
            createObject: {
              user_id: createdUser.user_id,
              encrypted_instance_url: tokens.encrypted_instance_url,
              is_logged_out: 1,
            },
            t,
          });
          if (errForCrmToken) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to add user to sub department',
              error: `Error while creating token to create: ${errForCrmToken}`,
            });
          }
        } else if (user?.Company?.integration_type === CRM_INTEGRATIONS.ZOHO) {
          const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
            tableName: DB_TABLES.COMPANY,
            query: {
              company_id: req.user.company_id,
            },
            include: {
              [DB_TABLES.COMPANY_SETTINGS]: {
                attributes: ['user_id'],
              },
            },
            extras: {
              attributes: ['company_id'],
            },
          });
          if (errCrmAdmin) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Could not find CRM admin',
              error: errCrmAdmin,
            });
          }
          const [tokens, errForTokens] = await Repository.fetchOne({
            tableName: DB_TABLES.ZOHO_TOKENS,
            query: {
              user_id: crmAdmin?.Company_Setting?.user_id,
            },
            extras: {
              attributes: ['data_center'],
            },
          });
          if (errForTokens) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to add user to sub department',
              error: `Error while fetching user: ${errForTokens}`,
            });
          }
          const [crmToken, errForCrmToken] = await Repository.create({
            tableName: tokenToCreate,
            createObject: {
              user_id: createdUser.user_id,
              data_center: tokens.data_center,
              is_logged_out: 1,
            },
            t,
          });
          if (errForCrmToken) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to add user to sub department',
              error: `Error while creating token to create: ${errForCrmToken}`,
            });
          }
        } else {
          const [crmToken, errForCrmToken] = await Repository.create({
            tableName: tokenToCreate,
            createObject: {
              user_id: createdUser.user_id,
              is_logged_out: 1,
            },
            t,
          });
          if (errForCrmToken) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to add user to sub department',
              error: `Error while creating token to create: ${errForCrmToken}`,
            });
          }
        }
      }

      const userToken = token.generateToken({ user_id: createdUser.user_id });

      // create product tour personal cadence
      const [cadenceCreated, errForCadenceCreated] =
        await CadenceHelper.createProductTourCadence({
          user_id: createdUser?.user_id,
          user_name: createdUser?.first_name || '',
          user_language: createdUser?.language || USER_LANGUAGES.ENGLISH,
          timezone: createdUser?.timezone,
          company_id: createdUser.company_id,
          integration_type: user?.Company?.integration_type,
          t,
        });
      if (errForCadenceCreated) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: `Failed to add user to sub department`,
          error: `Error while creating product tour cadences: ${errForCadenceCreated}`,
        });
      }

      // create default templates
      const [templateCreated, errForTemplateCreated] =
        await TemplateHelper.createDefaultTemplates({
          user_id: createdUser?.user_id,
          t,
        });
      if (errForTemplateCreated) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: `Failed to add user to sub department`,
          error: `Error while creating default templates: ${errForTemplateCreated}`,
        });
      }

      const [mail, err] = await AmazonService.sendHtmlMails({
        subject: OnboardingHelper.getSubjectForProductTourCadence({
          language: createdUser?.language,
        }),
        body: HtmlHelper.inviteMail({
          url: `${FRONTEND_URL}/crm/welcome`,
          user_first_name: createdUser?.first_name || '',
          inviting_user_first_name: user?.first_name || '',
          language: createdUser?.language,
        }),
        emailsToSend: [createdUser.email],
        tracking: true,
      });
      if (err) {
        t.rollback();
        if (err.includes('Sending paused for this account.'))
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'There is an issue with sending mails. Please try again after sometime or contact support',
          });
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to add user to sub department',
          error: `Error while sending mails: ${err}`,
        });
      }

      await Repository.update({
        tableName: DB_TABLES.USER_TOKEN,
        query: { user_id: createdUser?.user_id },
        updateObject: {
          onboarding_mail_message_id: mail?.MessageId,
          onboarding_mail_status: ONBOARDING_MAIL_STATUS.PROCESSING,
        },
        t,
      });

      t.commit();
      return createdSuccessResponse(
        res,
        'Admin created successfully and invite has been sent.',
        createdUser
      );
    }

    const [subDepartment, errForSubDepartment] = await Repository.fetchOne({
      tableName: DB_TABLES.SUB_DEPARTMENT,
      query: { sd_id: req.body.sd_id },
      include: {
        [DB_TABLES.DEPARTMENT]: {},
        [DB_TABLES.SUB_DEPARTMENT_SETTINGS]: {},
      },
      t,
    });
    if (errForSubDepartment) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add user to sub department',
        error: `Error while fetching sub department: ${errForSubDepartment}`,
      });
    }
    if (!subDepartment) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected group does not exist',
      });
    }

    const sdSettings = subDepartment.Sub_Department_Setting;

    let userObject = {
      ...req.body,
      sd_id: subDepartment.sd_id,
      department_id: subDepartment.department_id,
      company_id: subDepartment?.Department?.company_id,
      create_agendas_from_custom_task: 1,
      integration_type,
    };
    delete userObject.ringover_api_key;

    if (integration_type == USER_INTEGRATION_TYPES.SHEETS_USER)
      userObject.integration_id = `S${new Date().getTime()}`;

    const [createdUser, errForUser] = await Repository.create({
      tableName: DB_TABLES.USER,
      createObject: userObject,
      t,
    });

    if (errForUser) {
      t.rollback();
      if (errForUser.includes('must be unique'))
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Another user with the same email already exists in cadence',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add user to sub department',
        error: `Error while creating user: ${errForUser}`,
      });
    }

    const [profileUrl, errForProfileUrl] = await UserHelper.createAvatar({
      user_id: createdUser.user_id,
      first_name: createdUser.first_name,
      last_name: createdUser.last_name,
    });
    logger.error('Error creating avatar', errForProfileUrl);

    if (req.body.ringover_api_key != null) {
      const [encryptedRingoverApiKey, errForEncryptedRingoverApiKey] =
        CryptoHelper.encrypt(req.body.ringover_api_key);

      const [userToken, errForUserToken] = await Repository.create({
        tableName: DB_TABLES.USER_TOKEN,
        createObject: {
          encrypted_ringover_api_key: encryptedRingoverApiKey,
          user_id: createdUser.user_id,
          lusha_service_enabled: sdSettings.enable_new_users_lusha ?? false,
          kaspr_service_enabled: sdSettings.enable_new_users_kaspr ?? false,
        },
        t,
      });
      if (errForUserToken) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to add user to sub department',
          error: `Error while creating user token: ${errForUserToken}`,
        });
      }
    } else {
      const [userToken, errForUserToken] = await Repository.create({
        tableName: DB_TABLES.USER_TOKEN,
        createObject: {
          user_id: createdUser.user_id,
          lusha_service_enabled: sdSettings.enable_new_users_lusha ?? false,
          kaspr_service_enabled: sdSettings.enable_new_users_kaspr ?? false,
        },
        t,
      });
      if (errForUserToken) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to add user to sub department',
          error: `Error while creating user token: ${errForUserToken}`,
        });
      }
    }

    if (tokenToCreate)
      if (user?.Company?.integration_type === CRM_INTEGRATIONS.DYNAMICS) {
        const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
          tableName: DB_TABLES.COMPANY,
          query: {
            company_id: req.user.company_id,
          },
          include: {
            [DB_TABLES.COMPANY_SETTINGS]: {
              attributes: ['user_id'],
            },
          },
          extras: {
            attributes: ['company_id'],
          },
        });
        if (errCrmAdmin) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Could not find CRM admin',
            error: errCrmAdmin,
          });
        }
        const [tokens, errForTokens] = await Repository.fetchOne({
          tableName: DB_TABLES.DYNAMICS_TOKENS,
          query: {
            user_id: crmAdmin?.Company_Setting?.user_id,
          },
          extras: {
            attributes: ['encrypted_instance_url'],
          },
        });
        if (errForTokens) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add user to sub department',
            error: `Error while fetching user: ${errForTokens}`,
          });
        }
        const [crmToken, errForCrmToken] = await Repository.create({
          tableName: tokenToCreate,
          createObject: {
            user_id: createdUser.user_id,
            encrypted_instance_url: tokens.encrypted_instance_url,
            is_logged_out: 1,
          },
          t,
        });
        if (errForCrmToken) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add user to sub department',
            error: `Error while creating token to create: ${errForCrmToken}`,
          });
        }
      } else if (user?.Company?.integration_type === CRM_INTEGRATIONS.ZOHO) {
        const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
          tableName: DB_TABLES.COMPANY,
          query: {
            company_id: req.user.company_id,
          },
          include: {
            [DB_TABLES.COMPANY_SETTINGS]: {
              attributes: ['user_id'],
            },
          },
          extras: {
            attributes: ['company_id'],
          },
        });
        if (errCrmAdmin) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Could not find CRM admin',
            error: errCrmAdmin,
          });
        }
        const [tokens, errForTokens] = await Repository.fetchOne({
          tableName: DB_TABLES.ZOHO_TOKENS,
          query: {
            user_id: crmAdmin?.Company_Setting?.user_id,
          },
          extras: {
            attributes: ['data_center'],
          },
        });
        if (errForTokens) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add user to sub department',
            error: `Error while fetching user: ${errForTokens}`,
          });
        }
        const [crmToken, errForCrmToken] = await Repository.create({
          tableName: tokenToCreate,
          createObject: {
            user_id: createdUser.user_id,
            data_center: tokens.data_center,
            is_logged_out: 1,
          },
          t,
        });
        if (errForCrmToken) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add user to sub department',
            error: `Error while creating token to create: ${errForCrmToken}`,
          });
        }
      } else {
        const [crmToken, errForCrmToken] = await Repository.create({
          tableName: tokenToCreate,
          createObject: {
            user_id: createdUser.user_id,
            is_logged_out: 1,
          },
          t,
        });
        if (errForCrmToken) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to add user to sub department',
            error: `Error while creating crm token: ${errForCrmToken}`,
          });
        }
      }

    // create settings for user

    let unsubscribe_company_settings,
      bounced_company_settings,
      automated_company_settings,
      task_company_settings,
      skip_company_settings,
      lead_score_company_settings,
      automated_task_setting_priority = SETTING_LEVELS.SUB_DEPARTMENT,
      bounced_setting_priority = SETTING_LEVELS.SUB_DEPARTMENT,
      unsubscribe_setting_priority = SETTING_LEVELS.SUB_DEPARTMENT,
      task_setting_priority = SETTING_LEVELS.SUB_DEPARTMENT,
      skip_setting_priority = SETTING_LEVELS.SUB_DEPARTMENT,
      ls_setting_priority = SETTING_LEVELS.SUB_DEPARTMENT,
      error;

    let user_id = createdUser.user_id;

    let company_id = createdUser.company_id;

    [unsubscribe_company_settings, error] =
      await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery({
        sd_id: req.body.sd_id,
        priority: SETTING_LEVELS.SUB_DEPARTMENT,
      });
    if (!unsubscribe_company_settings) {
      unsubscribe_setting_priority = SETTING_LEVELS.ADMIN;
      [unsubscribe_company_settings, error] =
        await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
          {
            company_id,
            priority: SETTING_LEVELS.ADMIN,
          }
        );
    }

    [bounced_company_settings, error] =
      await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
        sd_id: req.body.sd_id,
        priority: SETTING_LEVELS.SUB_DEPARTMENT,
      });
    if (!bounced_company_settings) {
      bounced_setting_priority = SETTING_LEVELS.ADMIN;
      [bounced_company_settings, error] =
        await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
          company_id,
          priority: SETTING_LEVELS.ADMIN,
        });
    }

    [automated_company_settings, error] =
      await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
        sd_id: req.body.sd_id,
        priority: SETTING_LEVELS.SUB_DEPARTMENT,
      });
    if (!automated_company_settings) {
      automated_task_setting_priority = SETTING_LEVELS.ADMIN;
      [automated_company_settings, error] =
        await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
          company_id,
          priority: SETTING_LEVELS.ADMIN,
        });
    }

    [task_company_settings, error] =
      await TaskSettingsRepository.getTaskSettingByQuery({
        sd_id: req.body.sd_id,
        priority: SETTING_LEVELS.SUB_DEPARTMENT,
      });
    if (!task_company_settings) {
      task_setting_priority = SETTING_LEVELS.ADMIN;
      [task_company_settings, error] =
        await TaskSettingsRepository.getTaskSettingByQuery({
          company_id,
          priority: SETTING_LEVELS.ADMIN,
        });
    }

    [skip_company_settings, error] = await Repository.fetchOne({
      tableName: DB_TABLES.SKIP_SETTINGS,
      query: {
        sd_id: req.body.sd_id,
        priority: SETTING_LEVELS.SUB_DEPARTMENT,
      },
    });

    if (!skip_company_settings) {
      skip_setting_priority = SETTING_LEVELS.ADMIN;
      [skip_company_settings, error] = await Repository.fetchOne({
        tableName: DB_TABLES.SKIP_SETTINGS,
        query: {
          company_id: company_id,
          priority: SETTING_LEVELS.ADMIN,
        },
      });
    }

    if (!lead_score_company_settings) {
      ls_setting_priority = SETTING_LEVELS.ADMIN;
      [lead_score_company_settings, error] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
        query: {
          company_id: company_id,
          priority: SETTING_LEVELS.ADMIN,
        },
      });
    }

    if (error) {
      t.rollback();
      logger.error(`Error while adding user: `, error);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add user to sub department',
        error: `Error while fetching skip settings: ${error}`,
      });
    }

    const [createdSetting, errForCreatedSetting] = await Repository.create({
      tableName: DB_TABLES.SETTINGS,
      createObject: {
        user_id,
        automated_task_setting_priority,
        unsubscribe_setting_priority,
        bounced_setting_priority,
        task_setting_priority,
        skip_setting_priority,
        ls_setting_priority,
        at_settings_id: automated_company_settings.at_settings_id,
        unsubscribe_settings_id:
          unsubscribe_company_settings.unsubscribe_settings_id,
        bounced_settings_id: bounced_company_settings.bounced_settings_id,
        task_settings_id: task_company_settings.task_settings_id,
        skip_settings_id: skip_company_settings.skip_settings_id,
        ls_settings_id: lead_score_company_settings?.ls_settings_id,
        stats_columns: {
          totalTasks: 1,
          doneTasks: 2,
          skippedTasks: 3,
          pendingTasks: 4,
          disqualified: 5,
          converted: 6,
          calls: 0,
          semiAutomatedMails: 0,
          activeLeads: 0,
          automatedMails: 0,
          automatedSms: 0,
          semiAutomatedSms: 0,
          linkedin: 0,
          customTask: 0,
          demosBooked: 0,
          totalLeads: 0,
          whatsapp: 0,
          callback: 0,
          dataCheck: 0,
          lateTasks: 0,
          urgentTasks: 0,
        },
      },
      t,
    });
    if (errForCreatedSetting) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add user to sub department',
        error: `Error while creating settings: ${errForCreatedSetting}`,
      });
    }

    const [userTask, errForUserTask] = await Repository.create({
      tableName: DB_TABLES.USER_TASK,
      createObject: { user_id },
      t,
    });
    if (errForUserTask) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add user to sub department',
        error: `Error while creating user task: ${errForUserTask}`,
      });
    }

    // update user table with settings_id
    const [updatedUser, errForUpdatedUser] = await Repository.update({
      tableName: DB_TABLES.USER,
      updateObject: { settings_id: createdSetting.settings_id },
      query: { user_id },
      t,
    });
    if (errForUpdatedUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add user to sub department',
        error: `Error while updating user: ${errForUpdatedUser}`,
      });
    }

    // create product tour personal cadence
    const [cadenceCreated, errForCadenceCreated] =
      await CadenceHelper.createProductTourCadence({
        user_id,
        user_name: createdUser?.first_name || '',
        user_language: createdUser?.language || USER_LANGUAGES.ENGLISH,
        timezone: createdUser?.timezone,
        company_id,
        integration_type: user?.Company?.integration_type,
        t,
      });
    if (errForCadenceCreated) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to add user to sub department`,
        error: `Error while creating product tour cadences: ${errForCadenceCreated}`,
      });
    }

    // create default templates
    const [templateCreated, errForTemplateCreated] =
      await TemplateHelper.createDefaultTemplates({
        user_id: createdUser?.user_id,
        t,
      });
    if (errForTemplateCreated) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to add user to sub department`,
        error: `Error while creating default templates: ${errForTemplateCreated}`,
      });
    }

    const userToken = token.generateToken({ user_id: createdUser.user_id });

    const [mail, err] = await AmazonService.sendHtmlMails({
      subject: OnboardingHelper.getSubjectForProductTourCadence({
        language: createdUser?.language,
      }),
      body: HtmlHelper.inviteMail({
        url: `${FRONTEND_URL}/crm/welcome`,
        user_first_name: createdUser?.first_name || '',
        inviting_user_first_name: user?.first_name || '',
        language: createdUser?.language,
      }),
      emailsToSend: [createdUser.email],
      tracking: true,
    });
    if (err) {
      t.rollback();
      if (err.includes('Sending paused for this account.'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'There is an issue with sending mails. Please try again after sometime or contact support',
          error: `Error while sending mail: ${err}`,
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add user to sub department',
        error: `Error while sending mail: ${err}`,
      });
    }

    await Repository.update({
      tableName: DB_TABLES.USER_TOKEN,
      query: { user_id: createdUser?.user_id },
      updateObject: {
        onboarding_mail_message_id: mail?.MessageId,
        onboarding_mail_status: ONBOARDING_MAIL_STATUS.PROCESSING,
      },
      t,
    });

    t.commit();

    return createdSuccessResponse(
      res,
      'User created successfully.',
      createdUser
    );
  } catch (err) {
    t.rollback();
    logger.error(`Error while adding user to sub department: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while adding user to sub department: ${err.message}`,
    });
  }
};

const sendJoinRequestToUsers = async (req, res) => {
  try {
    const { user_ids } = req.body;
    const [users, errForUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: { user_id: { [Op.in]: user_ids } },
    });
    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to send join request to user',
        error: `Error while fetching user: ${errForUsers}`,
      });
    if (!users.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Users do not exist',
      });

    let onboardingCompleteFlag = false;
    for (let user of users) {
      if (!user.is_onboarding_complete) {
        onboardingCompleteFlag = true;
        const userToken = token.generateToken({ user_id: user.user_id });

        const [mail, err] = await AmazonService.sendHtmlMails({
          subject: OnboardingHelper.getSubjectForProductTourCadence({
            language: user?.language,
          }),
          body: HtmlHelper.inviteMail({
            url: `${FRONTEND_URL}/crm/welcome`,
            user_first_name: user?.first_name || '',
            inviting_user_first_name: req.user?.first_name || '',
            language: user?.language,
          }),
          emailsToSend: [user.email],
        });
        if (err) {
          if (err.includes('Sending paused for this account.'))
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'There is an issue with sending mails. Please try again after sometime or contact support',
              error: `Error while sending mails: ${err}`,
            });
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to send join request to user',
            error: `Error while sending mails: ${err}`,
          });
        }

        await Repository.update({
          tableName: DB_TABLES.USER_TOKEN,
          query: { user_id: user?.user_id },
          updateObject: {
            onboarding_mail_message_id: mail?.MessageId,
            onboarding_mail_status: ONBOARDING_MAIL_STATUS.PROCESSING,
          },
        });
      }
    }

    if (onboardingCompleteFlag)
      return successResponse(
        res,
        'Sent join request to those who have not completed onboarding.'
      );

    return successResponse(res, 'Sent join request to everyone successfully.');
  } catch (err) {
    logger.error(`Error while sending join request to users: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while sending join request to users: ${err.message}`,
    });
  }
};

const isPageAllowed = async (req, res) => {
  try {
    const { a_token } = req.query;

    const { valid } = token.access.verify(a_token);
    if (!valid)
      return unauthorizedResponseWithDevMsg({
        res,
        msg: 'Unauthorized',
      });

    return successResponse(res);
  } catch (err) {
    logger.error(`Error while checking if is page allowed: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while checking if is page allowed: ${err.message}`,
    });
  }
};

const setupPassword = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const params = subDepartmentSchema.setUpPasswordSchema.validate(req.body);
    if (params.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    const { a_token } = req.query;
    let { language } = req.body;

    const { valid, user_id } = token.access.verify(a_token);
    if (!valid) {
      t.rollback();
      return unauthorizedResponseWithDevMsg({
        res,
        msg: 'Unauthorized',
      });
    }

    let [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id },
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
      },
      t,
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to set password',
        error: `Error while fetching user: ${errForUser}`,
      });
    }

    const hashedPassword = bcrypt.hashSync(req.body.password, SALT_ROUNDS);

    // Step: set up update object for user
    let updateObjectForUser = {
      password: hashedPassword,
    };
    // Step: If language was passed, then it was updated, so updated language should be returned
    if (language) updateObjectForUser.language = language;

    const [updatedUser, errForUpdateUser] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: { user_id },
      updateObject: updateObjectForUser,
      t,
    });
    if (errForUpdateUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to set password',
        error: `Error while updating user: ${errForUpdateUser}`,
      });
    }
    // Step: If language was passed, then it was updated so pass the update language
    user.language = language || user.language;

    const [_, errForCalendarSettings] = await Repository.create({
      tableName: DB_TABLES.CALENDAR_SETTINGS,
      createObject: {
        user_id: user_id,
        meeting_buffer: 30,
        working_start_hour: '09:00',
        working_end_hour: '18:00',
        break_start_time: '13:00',
        break_end_time: '14:00',
        meeting_duration: [15, 30, 45, 60],
        working_days: [1, 1, 1, 1, 1, 0, 0],
      },
      t,
    });
    if (errForCalendarSettings) {
      t.rollback();
      if (errForCalendarSettings === 'user_id must be unique')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'You have already set your password',
        });

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to set password',
        error: `Error while creating calendar settings: ${errForCalendarSettings}`,
      });
    }

    const [userTask, errForUserTask] = await Repository.create({
      tableName: DB_TABLES.USER_TASK,
      createObject: { user_id },
      t,
    });
    if (errForUserTask) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to set password',
        error: `Error while creating user task: ${errForUserTask}`,
      });
    }

    t.commit();

    const accessToken = token.access.generate(
      user.user_id,
      user.email,
      user.first_name,
      user.role,
      user.sd_id
    );

    let tokens;
    switch (user.Company?.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        tokens = DB_TABLES.SALESFORCE_TOKENS;
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        tokens = DB_TABLES.PIPEDRIVE_TOKENS;
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        tokens = DB_TABLES.HUBSPOT_TOKENS;
        break;
      case CRM_INTEGRATIONS.ZOHO:
        tokens = DB_TABLES.ZOHO_TOKENS;
        break;
      case CRM_INTEGRATIONS.SELLSY:
        tokens = DB_TABLES.SELLSY_TOKENS;
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        tokens = DB_TABLES.BULLHORN_TOKENS;
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        tokens = DB_TABLES.DYNAMICS_TOKENS;
        break;
    }

    const [instanceUrl, errForInstanceUrl] = await Repository.fetchOne({
      tableName: tokens,
      query: { user_id: user.user_id },
    });

    const [__, errForValidToken] = await UserTokensHelper.setValidAccessToken(
      accessToken,
      user.user_id
    );
    if (errForValidToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to set password',
        error: `Error while setting valid access token: ${errForValidToken}`,
      });

    return successResponse(res, 'Password set and logged in successfully.', {
      accessToken,
      user_id: user.user_id,
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
      integration_type: user.Company.integration_type,
      instance_url: instanceUrl?.instance_url ?? '',
      phone_system: user.Company.Company_Setting.phone_system,
      mail_integration_type: user.Company.Company_Setting.mail_integration_type,
    });
  } catch (err) {
    t.rollback();
    logger.error(`Error while setting up password for user: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while setting up password for user: ${err.message}`,
    });
  }
};

const changeSubDepartmentForUser = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const body = subDepartmentSchema.changeSubDepartmentForUser.validate(
      req.body
    );
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    const { user_id, sd_id, lead_option, cadence_id } = body.value;
    let updateUserBody = { sd_id: sd_id };

    const [superAdmin, errForSuperAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      extras: {
        attributes: ['user_id', 'role'],
      },
    });
    if (errForSuperAdmin) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to change group',
        error: `Error while fetching super admin: ${errForSuperAdmin}`,
      });
    }
    if (!superAdmin) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'User not found',
      });
    }
    if (superAdmin.role != USER_ROLE.SUPER_ADMIN) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: "You don't have access to this feature, Only super admin can manage the group transition",
      });
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: user_id },
      include: {
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: ['sd_id', 'name'],
          [DB_TABLES.CADENCE]: {
            attributes: ['cadence_id'],
          },
          required: true,
        },
        [DB_TABLES.COMPANY]: {
          attributes: ['company_id', 'integration_type'],
          required: true,
        },
      },
      extras: {
        attributes: [
          'user_id',
          'company_id',
          'role',
          'sd_id',
          'first_name',
          'last_name',
        ],
      },
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to change group for user',
        error: `Error while fetching user: ${errForUser}`,
      });
    }
    if (!user) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'User does not exist',
      });
    }
    if ([USER_ROLE.SUPER_ADMIN].includes(user.role)) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: `'Super admin' are not allowed to change the group`,
      });
    }
    if (user.Sub_Department.name === 'Admin') {
      if (
        [USER_ROLE.SALES_PERSON, USER_ROLE.SALES_MANAGER].includes(
          req?.body?.role
        )
      )
        updateUserBody = { ...updateUserBody, role: req?.body?.role };
      else
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Provide valid user role',
        });
    }
    if (sd_id === user.sd_id) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You cannot select the same group',
      });
    }

    const old_sd_id = user.sd_id;
    const old_sd_name = user.Sub_Department.name;
    user.integration_type = user.Company.integration_type;

    const [targetedSubDepartment, errForTargetedSubDepartment] =
      await Repository.fetchOne({
        tableName: DB_TABLES.SUB_DEPARTMENT,
        query: { sd_id: sd_id },
        include: {
          [DB_TABLES.DEPARTMENT]: {
            attributes: ['department_id'],
            [DB_TABLES.COMPANY]: {
              attributes: ['company_id'],
              where: { company_id: user.company_id },
              required: true,
            },
            required: true,
          },
        },
        extras: {
          attributes: ['sd_id', 'name'],
        },
      });
    if (errForTargetedSubDepartment) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to change group for user',
        error: `Error while fetching sub department: ${errForTargetedSubDepartment}`,
      });
    }
    if (!targetedSubDepartment) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected group does not exist',
      });
    }
    if (targetedSubDepartment.name === 'Admin') {
      updateUserBody = { ...updateUserBody, role: USER_ROLE.ADMIN };
    }

    let cadences = user?.Sub_Department?.Cadences;
    const cadence_ids = cadences.map((c) => c.cadence_id);

    const [fetchUserLeads, errForFetchingUserLeads] = await Repository.fetchAll(
      {
        tableName: DB_TABLES.LEAD,
        query: { user_id: user.user_id },
        include: {
          [DB_TABLES.LEADTOCADENCE]: {
            where: { cadence_id: { [Op.in]: cadence_ids } },
            attributes: ['lead_cadence_id', 'cadence_id'],
            [DB_TABLES.CADENCE]: {
              attributes: ['cadence_id', 'type'],
            },
            required: true,
          },
        },
        extras: {
          attributes: [
            'lead_id',
            'salesforce_lead_id',
            'salesforce_contact_id',
            'integration_type',
            'account_id',
          ],
        },
      }
    );
    if (errForFetchingUserLeads) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch leads',
        error: `Error while fetching leads: ${errForFetchingUserLeads}`,
      });
    }

    const sheet_lead_ids = [];
    const sheet_acc_ids = [];
    const lead_ids = [];
    const non_sheets_lead_ids = [];
    const account_ids = [];

    fetchUserLeads.forEach((l) => {
      lead_ids.push(l.lead_id); // Collect all lead_ids irrespective of integration_type
      account_ids.push(l.account_id);
      if (l.integration_type === LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD) {
        sheet_lead_ids.push(l.lead_id);
        sheet_acc_ids.push(l.account_id);
      } else {
        non_sheets_lead_ids.push(l.lead_id);
      }
    });

    const leads = fetchUserLeads;
    let deleteLtcLinks = [];

    const userLeadsCadenceIds = fetchUserLeads.flatMap((item) =>
      item.LeadToCadences.map((ltc) => ltc.cadence_id)
    );
    // Get unique cadence_id values
    const uniqueCadenceIds = [...new Set(userLeadsCadenceIds)];

    const [_, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: { user_id: user_id },
      updateObject: updateUserBody,
      t,
    });
    if (errForUpdate) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to change group for user',
        error: `Error whie updating user: ${errForUpdate}`,
      });
    }

    let [reConfigUserSettings, errForReConfigUserSettings] =
      await SettingsHelpers.reconfigureUserSettingsAfterTeamChange({
        user,
        sd_id,
        t,
      });
    if (errForReConfigUserSettings) {
      t.rollback();
      serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to change group',
        err: `Error while reconfig user's settings: ${errForReConfigUserSettings}`,
      });
    }

    if (lead_ids.length > 0)
      switch (lead_option) {
        case TEAM_CHANGE_OPTIONS.MOVE_LEADS_TO_ANOTHER_CADENCE:
          const [cadence, errForFetchingCadence] = await Repository.fetchOne({
            tableName: DB_TABLES.CADENCE,
            query: { cadence_id },
            include: {
              [DB_TABLES.USER]: {
                attributes: ['user_id', 'company_id'],
                required: true,
              },
            },
            t,
          });
          if (errForFetchingCadence) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to change user',
              error: `Error while fetching cadence: ${errForFetchingCadence}`,
            });
          }
          if (!cadence) {
            t.rollback();
            return notFoundResponseWithDevMsg({
              res,
              msg: 'Selected cadence not found',
            });
          }
          if (cadence.type === CADENCE_TYPES.TEAM) {
            t.rollback();
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Targeted cadence should be personal cadence or company cadence',
              error: 'Team cadences not supported',
            });
          }
          const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess(
            {
              cadence: cadence,
              user,
              action: CADENCE_ACTIONS.REASSIGN,
            }
          );
          if (errForAccess) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: "User don't have access to selected cadence",
              error: `Error for cadence action access: ${errForAccess}`,
            });
          }

          let [moveLeadsToAnotherCadence, errForMovingLeadsToAnotherCadence] =
            await LeadHelper.moveLeadsToAnotherCadence({
              cadence_ids_to_stop: uniqueCadenceIds,
              cadenceToStart: cadence,
              option: BULK_OPTIONS.SELECTED,
              user,
              leads: fetchUserLeads,
              t,
            });
          if (
            errForMovingLeadsToAnotherCadence
              ?.toLowerCase()
              ?.includes(
                'move to another cadence is not supported for google sheets leads or cadence with google sheet leads'.toLowerCase()
              )
          ) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Selected cadence should not be linked with Google Sheets leads',
            });
          }
          if (errForMovingLeadsToAnotherCadence) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to move cadence to another cadence',
              error: `Error moving cadence to another cadence: ${errForMovingLeadsToAnotherCadence}`,
            });
          }
          if (sheet_lead_ids.length > 0) {
            // Deleting google sheet leads
            logger.info(
              `Deleting google sheet leads: ${sheet_lead_ids.length}`
            );
            const [deletedAllLeadInfo, errForDeletedAllLeadInfo] =
              await LeadHelper.deleteAllLeadInfo({
                leadIds: sheet_lead_ids,
                accountIds: sheet_acc_ids,
                t,
              });
            if (errForDeletedAllLeadInfo) {
              t.rollback();
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to delete leads',
                error: `Error while deleting all leads info: ${errForDeletedAllLeadInfo}`,
              });
            }
            let [
              updateCadenceIntegrationType,
              errForUpdatingCadenceIntegrationType,
            ] = await CadenceHelper.updateCadenceIntegrationTypeForSheetsIntegration(
              uniqueCadenceIds,
              t
            );
            if (errForUpdatingCadenceIntegrationType) {
              t.rollback();
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to change group',
                error: `Error while updating cadence integration for sheets integration: ${errForUpdatingCadenceIntegrationType}`,
              });
            }

            let [leadCadences, errForleadCadences] =
              await CadenceHelper.getCadencesOfLeads({
                lead_ids: moveLeadsToAnotherCadence?.gsLeadIds,
              });
            if (errForleadCadences) {
              t.rollback();
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to change group',
                error: `Error while fetching cadences of leads: ${errForleadCadences}`,
              });
            }

            const sheetsDeletePromises = leadCadences.map((cadence) => {
              return GoogleSheetsHelper.bulkLeadDeleteByCadence({
                cadence,
                lead_ids: moveLeadsToAnotherCadence?.gsLeadIds,
              });
            });
            const settledPromises = await Promise.allSettled(
              sheetsDeletePromises
            );
            for (let settledPromise of settledPromises) {
              if (settledPromise.status == 'rejected')
                logger.error('lead deletion failed :', settledPromise.reason);
              else {
                const [cadence, _] = settledPromise?.value;
                if (cadence)
                  logger.info(
                    `google sheet ${cadence.salesforce_cadence_id} updated successfully`
                  );
              }
            }
          }
          break;

        case TEAM_CHANGE_OPTIONS.UNLINK_LEADS_FROM_CADENCE:
          for (let lead of leads) {
            // TO BE DONE FOR TEAM CADENCE
            for (let ltc of lead.LeadToCadences)
              if (ltc.Cadences[0].type === CADENCE_TYPES.TEAM)
                deleteLtcLinks.push(ltc.lead_cadence_id);
          }

          let [deleteLeadToCadenceLinks, errForDeletingLeadToCadenceLinks] =
            await Repository.destroy({
              tableName: DB_TABLES.LEADTOCADENCE,
              query: { lead_cadence_id: { [Op.in]: deleteLtcLinks } },
              t,
            });
          if (errForDeletingLeadToCadenceLinks) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to change group',
              error: `Error while deleting lead to cadence link: ${errForDeletingLeadToCadenceLinks}`,
            });
          }

          if (user.integration_type === CRM_INTEGRATIONS.SHEETS) {
            let [
              updateCadenceIntegrationType,
              errForUpdatingCadenceIntegrationType,
            ] = await CadenceHelper.updateCadenceIntegrationTypeForSheetsIntegration(
              uniqueCadenceIds,
              t
            );
            if (errForUpdatingCadenceIntegrationType) {
              t.rollback();
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to change group',
                error: `Error while updating cadence integration for sheets integration: ${errForUpdatingCadenceIntegrationType}`,
              });
            }
            if (sheet_lead_ids.length > 0) {
              let [leadCadences, errForleadCadences] =
                await CadenceHelper.getCadencesOfLeads({
                  lead_ids: sheet_lead_ids,
                });
              if (errForleadCadences) {
                t.rollback();
                return serverErrorResponseWithDevMsg({
                  res,
                  msg: 'Failed to change group',
                  error: `Error while fetching cadences of leads: ${errForleadCadences}`,
                });
              }

              const sheetsDeletePromises = leadCadences.map((cadence) => {
                return GoogleSheetsHelper.bulkLeadDeleteByCadence({
                  cadence,
                  lead_ids: sheet_lead_ids,
                });
              });
              const settledPromises = await Promise.allSettled(
                sheetsDeletePromises
              );
              for (let settledPromise of settledPromises) {
                if (settledPromise.status == 'rejected')
                  logger.error('lead deletion failed :', settledPromise.reason);
                else {
                  const [cadence, _] = settledPromise?.value;
                  if (cadence)
                    logger.info(
                      `google sheet ${cadence.salesforce_cadence_id} updated successfully`
                    );
                }
              }
            }
          }

          const [activityFromTemplate, errForActivityFromTemplate] =
            ActivityHelper.getActivityFromTemplates({
              type: ACTIVITY_TYPE.UNLINKED_LEAD,
              variables: {},
              activity: {},
            });

          const [data, err] = await Repository.bulkCreate({
            tableName: DB_TABLES.ACTIVITY,
            createObject: leads.map((lead) => {
              return {
                lead_id: lead.lead_id,
                name: activityFromTemplate.name,
                status: activityFromTemplate.status,
                type: activityFromTemplate.type,
              };
            }),
            t,
          });
          break;

        case TEAM_CHANGE_OPTIONS.DELETE_LEADS:
          const [deletedAllLeadInfo, errForDeletedAllLeadInfo] =
            await LeadHelper.deleteAllLeadInfo({
              leadIds: lead_ids,
              accountIds: account_ids,
              t,
            });
          if (errForDeletedAllLeadInfo) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to delete leads',
              error: `Error while deleting all leads info: ${errForDeletedAllLeadInfo}`,
            });
          }
          if (user.integration_type === CRM_INTEGRATIONS.SHEETS) {
            let [
              updateCadenceIntegrationType,
              errForUpdatingCadenceIntegrationType,
            ] = await CadenceHelper.updateCadenceIntegrationTypeForSheetsIntegration(
              uniqueCadenceIds,
              t
            );
            if (errForUpdatingCadenceIntegrationType) {
              t.rollback();
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to change group',
                error: `Error while updating cadence integration for sheets integration: ${errForUpdatingCadenceIntegrationType}`,
              });
            }

            for (let lead of leads) {
              if (req.user.integration_type === CRM_INTEGRATIONS.SHEETS)
                if (
                  lead?.integration_type ===
                  LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD
                )
                  sheet_lead_ids.push(lead.lead_id);
            }
            if (sheet_lead_ids.length > 0) {
              let [leadCadences, errForleadCadences] =
                await CadenceHelper.getCadencesOfLeads({
                  lead_ids: sheet_lead_ids,
                });
              if (errForleadCadences) {
                t.rollback();
                return serverErrorResponseWithDevMsg({
                  res,
                  msg: 'Failed to change group',
                  error: `Error while fetching cadences of leads: ${errForleadCadences}`,
                });
              }

              const sheetsDeletePromises = leadCadences.map((cadence) => {
                return GoogleSheetsHelper.bulkLeadDeleteByCadence({
                  cadence,
                  lead_ids: sheet_lead_ids,
                });
              });
              const settledPromises = await Promise.allSettled(
                sheetsDeletePromises
              );
              for (let settledPromise of settledPromises) {
                if (settledPromise.status == 'rejected')
                  logger.error('lead deletion failed :', settledPromise.reason);
                else {
                  const [cadence, _] = settledPromise?.value;
                  if (cadence)
                    logger.info(
                      `google sheet ${cadence.salesforce_cadence_id} updated successfully`
                    );
                }
              }
            }
          }
          break;

        default:
          break;
      }
    else logger.info(`No leads to move for user ID: ${user.user_id}`);

    let [trackTeamChangeForUser, errForTrackingTemaChangeForUser] =
      await Repository.create({
        tableName: DB_TABLES.TRACKING,
        createObject: {
          activity: TRACKING_ACTIVITIES.TEAM_CHANGED,
          reason: TRACKING_REASONS.MANUALLY_TEAM_CHANGED,
          metadata: {
            old_sd_id,
            old_sd_name,
            new_sd_id: targetedSubDepartment?.sd_id,
            new_sd_name: targetedSubDepartment?.name,
            lead_option,
          },
          user_id,
        },
        t,
      });
    if (errForTrackingTemaChangeForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to change team',
        error: `Error while creating user tracking for team change: ${errForTrackingTemaChangeForUser}`,
      });
    }

    // Logout user
    let [deleteRingoverTokens, errForDeletingRingoverTokens] =
      await Repository.destroy({
        tableName: DB_TABLES.RINGOVER_TOKENS,
        query: { user_id },
        t,
      });
    if (errForDeletingRingoverTokens) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to change team',
        error: `Error while deleting ringover tokens for user: ${errForDeletingRingoverTokens}`,
      });
    }

    t.commit();
    TaskHelper.recalculateDailyTasksForUsers([user.user_id]);
    return successResponse(res, 'Group changed successfully');
  } catch (err) {
    t.rollback();
    logger.error('Error while changing sub department for user: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while changing sub department for user: ${err.message}`,
    });
  }
};

// * Fetch users from Ringover
const getUsersFromRingover = async (req, res) => {
  try {
    logger.info('Fetching users from Ringover', { user_id: req.user.user_id });

    let { data } = await axios.get(
      `${RingoverHelper.regionURL(req.user.region)}/gateway/app/team/members`,
      {
        headers: {
          Authorization: `Bearer ${req.user.access_token}`,
        },
      }
    );

    return successResponse(
      res,
      'Successfully fetched users from Ringover',
      data
    );
  } catch (err) {
    logger.error('Error while getting users from Ringover: ', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while getting users from Ringover: ${err.message}`,
    });
  }
};

const getTeamUserInfo = async (req, res) => {
  try {
    const { user_id } = req.params;
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: user_id },
      include: {
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: ['sd_id'],
          [DB_TABLES.CADENCE]: {
            attributes: ['cadence_id'],
          },
          required: true,
        },
        [DB_TABLES.COMPANY]: {
          attributes: ['company_id', 'integration_type'],
          required: true,
        },
      },
      extras: {
        attributes: [
          'user_id',
          'company_id',
          'role',
          'sd_id',
          'first_name',
          'last_name',
        ],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to change group for user',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'User does not exist',
      });

    let cadences = user?.Sub_Department?.Cadences;
    const cadence_ids = cadences.map((c) => c.cadence_id);

    const [fetchUserLeads, errForFetchingUserLeads] = await Repository.fetchAll(
      {
        tableName: DB_TABLES.LEAD,
        query: { user_id: user.user_id },
        include: {
          [DB_TABLES.LEADTOCADENCE]: {
            where: { cadence_id: { [Op.in]: cadence_ids } },
            attributes: ['lead_cadence_id', 'cadence_id'],
            [DB_TABLES.CADENCE]: {
              attributes: ['cadence_id', 'type'],
            },
            required: true,
          },
        },
        extras: {
          attributes: [
            'lead_id',
            'salesforce_lead_id',
            'salesforce_contact_id',
            [
              sequelize.fn('COUNT', sequelize.col(DB_TABLES.LEAD + '.lead_id')),
              'lead_count',
            ],
            'integration_type',
          ],
          group: ['integration_type'],
        },
      }
    );
    if (errForFetchingUserLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch leads',
        error: `Error while fetching leads: ${errForFetchingUserLeads}`,
      });

    let leadCount = 0;
    let contactCount = 0;
    let candidateCount = 0;
    let personCount = 0;
    switch (user.Company.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        fetchUserLeads.reduce((acc, lead) => {
          if (
            [
              LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD,
              LEAD_INTEGRATION_TYPES.SALESFORCE_CSV_LEAD,
              LEAD_INTEGRATION_TYPES.SALESFORCE_GOOGLE_SHEET_LEAD,
            ].includes(lead.integration_type)
          )
            leadCount += lead.lead_count;
          else if (
            [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT].includes(
              lead.integration_type
            )
          )
            contactCount += lead.lead_count;
        }, {});
        return successResponse(res, 'Successfully fetched user leads', {
          leadCount,
          contactCount,
        });

      case CRM_INTEGRATIONS.BULLHORN:
        fetchUserLeads.reduce((acc, lead) => {
          if (
            [
              LEAD_INTEGRATION_TYPES.BULLHORN_LEAD,
              LEAD_INTEGRATION_TYPES.BULLHORN_CSV_LEAD,
              LEAD_INTEGRATION_TYPES.BULLHORN_GOOGLE_SHEET_LEAD,
            ].includes(lead.integration_type)
          )
            leadCount += lead.lead_count;
          else if (
            [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT].includes(
              lead.integration_type
            )
          )
            contactCount += lead.lead_count;
          else if (
            [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE].includes(
              lead.integration_type
            )
          )
            candidateCount += lead.lead_count;
        }, {});
        return successResponse(res, 'Successfully fetched user leads', {
          leadCount,
          contactCount,
          candidateCount,
        });

      case CRM_INTEGRATIONS.DYNAMICS:
        fetchUserLeads.reduce((acc, lead) => {
          if (
            [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD].includes(
              lead.integration_type
            )
          )
            leadCount += lead.lead_count;
          else if (
            [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT].includes(
              lead.integration_type
            )
          )
            contactCount += lead.lead_count;
        }, {});
        return successResponse(res, 'Successfully fetched user leads', {
          leadCount,
          contactCount,
        });

      case CRM_INTEGRATIONS.SHEETS:
        fetchUserLeads.reduce((acc, lead) => {
          if (
            [
              LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD,
              LEAD_INTEGRATION_TYPES.EXCEL_LEAD,
            ].includes(lead.integration_type)
          )
            leadCount += lead.lead_count;
        }, {});
        return successResponse(res, 'Successfully fetched user leads', {
          leadCount,
        });

      case CRM_INTEGRATIONS.PIPEDRIVE:
        fetchUserLeads.reduce((acc, lead) => {
          if (
            [
              LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON,
              LEAD_INTEGRATION_TYPES.PIPEDRIVE_GOOGLE_SHEET_PERSON,
              LEAD_INTEGRATION_TYPES.PIPEDRIVE_CSV_PERSON,
            ].includes(lead.integration_type)
          )
            personCount += lead.lead_count;
        }, {});
        return successResponse(res, 'Successfully fetched user leads', {
          personCount,
        });

      case CRM_INTEGRATIONS.HUBSPOT:
        fetchUserLeads.reduce((acc, lead) => {
          if (
            [
              LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT,
              LEAD_INTEGRATION_TYPES.HUBSPOT_GOOGLE_SHEET_CONTACT,
              LEAD_INTEGRATION_TYPES.HUBSPOT_CSV_CONTACT,
            ].includes(lead.integration_type)
          )
            contactCount += lead.lead_count;
        }, {});
        return successResponse(res, 'Successfully fetched user leads', {
          contactCount,
        });

      case CRM_INTEGRATIONS.ZOHO:
        fetchUserLeads.reduce((acc, lead) => {
          if (
            [
              LEAD_INTEGRATION_TYPES.ZOHO_LEAD,
              LEAD_INTEGRATION_TYPES.ZOHO_CSV_LEAD,
              LEAD_INTEGRATION_TYPES.ZOHO_GOOGLE_SHEET_LEAD,
            ].includes(lead.integration_type)
          )
            leadCount += lead.lead_count;
          else if (
            [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT].includes(
              lead.integration_type
            )
          )
            contactCount += lead.lead_count;
        }, {});
        return successResponse(res, 'Successfully fetched user leads', {
          leadCount,
          contactCount,
        });

      case CRM_INTEGRATIONS.SELLSY:
        fetchUserLeads.reduce((acc, lead) => {
          if (
            [
              LEAD_INTEGRATION_TYPES.SELLSY_CONTACT,
              LEAD_INTEGRATION_TYPES.SELLSY_CSV_CONTACT,
              LEAD_INTEGRATION_TYPES.SELLSY_GOOGLE_SHEET_CONTACT,
            ].includes(lead.integration_type)
          )
            contactCount += lead.lead_count;
        }, {});
        return successResponse(res, 'Successfully fetched user leads', {
          contactCount,
        });

      default:
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Invalid interaction type',
        });
    }
  } catch (err) {
    logger.error('Error while getting users from Ringover: ', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while getting users from Ringover: ${err.message}`,
    });
  }
};

const SubDepartmentController = {
  getAllEmployeesForManager,
  getAllEmployeesForAdmin,
  getAllAdminsForAdmin,
  createSubDepartment,
  updateSubDepartment,
  fetchAllSubDepartmentsForCompany,
  fetchAllSubDepartmentsForCompanyWithUsersAndAdmins,
  deleteSubDepartment,
  addUsersToSubDepartmentViaCSV,
  addUserToSubDepartment,
  sendJoinRequestToUsers,
  isPageAllowed,
  setupPassword,
  changeSubDepartmentForUser,
  getUsersFromRingover,
  getTeamUserInfo,
};

module.exports = SubDepartmentController;

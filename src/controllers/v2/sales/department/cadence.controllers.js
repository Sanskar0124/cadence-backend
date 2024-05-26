// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');

const {
  LEAD_STATUS,
  NODE_TYPES,
  CADENCE_LEAD_STATUS,
  ACTIVITY_TYPE,
  USER_ROLE,
  CADENCE_STATUS,
  CADENCE_ACTIONS,
  CADENCE_TYPES,
  WORKFLOW_TRIGGERS,
  EMAIL_STATUS,
  ACTIVITY_SUBTYPES,
  CRM_INTEGRATIONS,
  BULK_OPTIONS,
  MAIL_INTEGRATION_TYPES,
  CADENCE_STEPS_STATS_TYPE,
  SMS_STATUS,
  LEAD_INTEGRATION_TYPES,
  TASK_STATUSES,
  SHEETS_CADENCE_INTEGRATION_TYPE,
  HIRING_INTEGRATIONS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
  DB_MODELS,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  INTEGRATION_ID_FOR_PRODUCT_TOUR_CADENCE,
} = require('../../../../../../Cadence-Brain/src/utils/constants');

// Packages
const { Op, QueryTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

// Repositories
const {
  sequelize,
  Sequelize,
  Task,
} = require('../../../../../../Cadence-Brain/src/db/models');
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const CadenceRepository = require('../../../../../../Cadence-Brain/src/repository/cadence.repository');

// Helpers and Services
const NodeHelper = require('../../../../../../Cadence-Brain/src/helper/node');
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const CadenceHelper = require('../../../../../../Cadence-Brain/src/helper/cadence');
const SalesforceService = require('../../../../../../Cadence-Brain/src/services/Salesforce');
const WorkflowHelper = require('../../../../../../Cadence-Brain/src/helper/workflow');
const LeadHelper = require('../../../../../../Cadence-Brain/src/helper/lead');
const AutomatedTasksHelper = require('../../../../../../Cadence-Brain/src/helper/automated-tasks');
const SalesforceHelper = require('../../../../../../Cadence-Brain/src/helper/salesforce');
const AccessTokenHelper = require('../../../../../../Cadence-Brain/src/helper/access-token');
const SocketHelper = require('../../../../../../Cadence-Brain/src/helper/socket');
const CompanyFieldMapHelper = require('../../../../../../Cadence-Brain/src/helper/company-field-map');

// Joi validation
const cadenceSchema = require('../../../../joi/v2/sales/department/cadence.joi');
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');

const createCadence = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const body = cadenceSchema.createCadenceSchema.validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      t,
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create cadence',
        error: `Error while fetching user: ${errForUser}`,
      });
    }

    req.body.status = CADENCE_STATUS.NOT_STARTED;
    if (req.user.integration_type === CRM_INTEGRATIONS.SHEETS)
      req.body.integration_type = null;

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence: req.body,
      user,
      action: CADENCE_ACTIONS.CREATE,
    });
    if (errForAccess) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create cadence',
        error: `Error while checking cadence action access: ${errForAccess}`,
      });
    }
    if (!access) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });
    }
    const { integration_type } = req.user;

    req.body.company_id = req.user.company_id;

    // * create a cadence
    const [cadence, errForCadence] = await Repository.create({
      tableName: DB_TABLES.CADENCE,
      createObject: req.body,
      t,
    });
    if (errForCadence) {
      t.rollback();
      if (errForCadence.includes('uniqueCadenceNamePerCompany must be unique'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: `A cadence with same name exists, please use another name`,
        });

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create cadence',
        error: `Error while creating cadence: ${errForCadence}`,
      });
    }

    //let tags = req.body.tags;
    //for (let tag of tags) tag.cadence_id = cadence.cadence_id;

    //const [createdTags, errForTags] = await Repository.bulkCreate({
    //tableName: DB_TABLES.TAG,
    //createObject: tags,
    //t,
    //});
    //if (errForTags) {
    //t.rollback();
    //return serverErrorResponse(res, errForTags);
    //}
    //cadence.tags = createdTags;

    let salesforceCadence = '',
      errForSfCadence = '';

    switch (integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE: {
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });
        if (
          [
            'Kindly sign in with your crm.',
            'Kindly log in with salesforce.',
            'Error while getting access token and refresh token from salesforce auth',
          ].includes(errForAccessToken)
        ) {
          t.rollback();
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Kindly connect with salesforce to create a cadence',
          });
        }

        // Creating cadence in salesforce
        [salesforceCadence, errForSfCadence] =
          await SalesforceService.createCadence(
            cadence,
            access_token,
            instance_url
          );
        if (errForSfCadence) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to create cadence',
            error: `Error while creating cadence in salesforce: ${errForSfCadence}`,
          });
        }
        break;
      }
      default:
        logger.info('Cadence not required to be created in CRM.');
        break;
    }

    // *Updating salesforce cadence id in db
    await Repository.update({
      tableName: DB_TABLES.CADENCE,
      updateObject: { salesforce_cadence_id: salesforceCadence },
      query: { cadence_id: cadence.cadence_id },
      t,
    });

    if (req.body.scheduled) {
      const [schedule, errForSchedule] = await Repository.create({
        tableName: DB_TABLES.CADENCE_SCHEDULE,
        createObject: {
          launch_at: req.body.launch_at,
          cadence_id: cadence.cadence_id,
        },
        t,
      });

      if (errForSchedule) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create cadence',
          error: `Error while creating cadence schedule: ${errForSchedule}`,
        });
      }
    }

    t.commit();
    return successResponse(res, 'Cadence created successfully.', cadence);
  } catch (err) {
    t.rollback();
    logger.error(`Error while creating cadence: `, err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating cadence: ${err.message}`,
    });
  }
};

const getAllCadences = async (req, res) => {
  try {
    const body = cadenceSchema.fetchCadenceSchema.validate(req.query);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    const { user_id, company_id, role, sd_id } = req.user;

    let query = {},
      andQuery = [{ company_id }],
      include = {};

    switch (req.query.type) {
      // Personal cadences
      case CADENCE_TYPES.PERSONAL:
        {
          // Switch according to role
          switch (role) {
            case USER_ROLE.SALES_PERSON: {
              andQuery.push(
                {
                  user_id,
                },
                { type: CADENCE_TYPES.PERSONAL }
              );
              include = {
                [DB_TABLES.CADENCE_SCHEDULE]: {
                  attributes: ['launch_at'],
                },
                [DB_TABLES.NODE]: {
                  attributes: ['node_id'],
                },
                [DB_TABLES.USER]: {
                  where: { sd_id },
                  attributes: ['first_name', 'last_name'],
                  required: true,
                },
                [DB_TABLES.LEADTOCADENCE]: {
                  attributes: ['lead_id'],
                },
              };
              break;
            }
            case USER_ROLE.SALES_MANAGER: {
              andQuery.push({ type: CADENCE_TYPES.PERSONAL });
              include = {
                [DB_TABLES.CADENCE_SCHEDULE]: {
                  attributes: ['launch_at'],
                },
                [DB_TABLES.NODE]: {
                  attributes: ['node_id'],
                },
                [DB_TABLES.USER]: {
                  where: { sd_id },
                  attributes: ['first_name', 'last_name'],
                  required: true,
                },
                [DB_TABLES.LEADTOCADENCE]: {
                  attributes: ['lead_id'],
                },
              };
              break;
            }
            case USER_ROLE.SUPER_ADMIN:
            case USER_ROLE.ADMIN: {
              andQuery.push({ type: CADENCE_TYPES.PERSONAL });
              include = {
                [DB_TABLES.CADENCE_SCHEDULE]: {
                  attributes: ['launch_at'],
                },
                [DB_TABLES.USER]: {
                  [DB_TABLES.SUB_DEPARTMENT]: {
                    attributes: ['sd_id', 'name'],
                  },
                  attributes: ['first_name', 'last_name', 'sd_id'],
                  where: { company_id },
                  required: true,
                },
                [DB_TABLES.NODE]: {
                  attributes: ['node_id'],
                },
                [DB_TABLES.LEADTOCADENCE]: {
                  attributes: ['lead_id'],
                },
              };
              break;
            }
            default:
              return badRequestResponseWithDevMsg({
                res,
                msg: 'You do not have permission to access this',
                error: 'Not an appropriate role',
              });
          }
        }
        break;

      // Company cadences
      case CADENCE_TYPES.COMPANY: {
        andQuery.push({
          type: CADENCE_TYPES.COMPANY,
        });
        include = {
          [DB_TABLES.CADENCE_SCHEDULE]: {
            attributes: ['launch_at'],
          },
          [DB_TABLES.NODE]: {
            attributes: ['node_id'],
          },
          [DB_TABLES.USER]: {
            [DB_TABLES.SUB_DEPARTMENT]: {
              attributes: ['sd_id', 'name'],
            },
            attributes: ['first_name', 'last_name'],
          },
          [DB_TABLES.LEADTOCADENCE]: {
            attributes: ['lead_id'],
          },
        };
        break;
      }

      case CADENCE_TYPES.RECENT:
        {
          let recentQuery = {};
          let extrasQuery = {
            attributes: ['recent_action_id', 'updated_at'],
            order: [['updated_at', 'DESC']],
          };
          let query = {
            user_id,
          };

          // * Handle search query
          if (req.query.search)
            recentQuery = sequelize.literal(
              `LOWER(name) LIKE '%${req.query.search.trim().toLowerCase()}%'`
            );

          if (req.query?.limit) extrasQuery.limit = parseInt(req.query.limit);
          if (req.query?.updated_at)
            query.updated_at = {
              [Op.lt]: req.query.updated_at,
            };

          let [cadences, errFetchingCadences] = await Repository.fetchAll({
            tableName: DB_TABLES.RECENT_ACTION,
            query,
            include: {
              [DB_TABLES.CADENCE]: {
                where: recentQuery,
                attributes: ['cadence_id', 'name', 'status', 'type'],
                required: true,
              },
            },
            extras: extrasQuery,
          });
          if (errFetchingCadences)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Unable to fetch recent cadences. Please try again later',
              error: errFetchingCadences,
            });

          return successResponse(
            res,
            'Cadences fetched successfully.',
            cadences
          );
        }
        break;

      // DEPRECATED -- code kept only for any future use
      // Team cadences
      case CADENCE_TYPES.TEAM:
        {
          return badRequestResponseWithDevMsg({
            res,
            msg: `Something went wrong while fetching cadences`,
            error: `Team cadences are not supported`,
          });
          // Switch according to role
          switch (role) {
            case USER_ROLE.SALES_PERSON:
            case USER_ROLE.SALES_MANAGER: {
              andQuery.push({ sd_id }, { type: CADENCE_TYPES.TEAM });
              include = {
                [DB_TABLES.CADENCE_SCHEDULE]: {
                  attributes: ['launch_at'],
                },
                [DB_TABLES.LEADTOCADENCE]: {
                  attributes: ['lead_id'],
                },
                [DB_TABLES.NODE]: {
                  attributes: ['node_id'],
                },
                [DB_TABLES.USER]: {
                  attributes: ['first_name', 'last_name'],
                },
              };
              break;
            }
            case USER_ROLE.SUPER_ADMIN:
            case USER_ROLE.ADMIN: {
              andQuery.push({
                type: CADENCE_TYPES.TEAM,
              });
              include = {
                [DB_TABLES.CADENCE_SCHEDULE]: {
                  attributes: ['launch_at'],
                },
                [DB_TABLES.SUB_DEPARTMENT]: {
                  attributes: ['sd_id', 'name'],
                  required: true,
                },
                [DB_TABLES.NODE]: {
                  attributes: ['node_id'],
                },
                [DB_TABLES.USER]: {
                  attributes: ['first_name', 'last_name'],
                },
                [DB_TABLES.LEADTOCADENCE]: {
                  attributes: ['lead_id'],
                },
              };
              break;
            }
            default:
              return badRequestResponseWithDevMsg({
                res,
                msg: 'Not an appropriate role',
              });
          }
        }
        break;
    }

    if (req.query.status) {
      if (req.query.status === CADENCE_STATUS.SCHEDULED) {
        include = {
          ...include,
          [DB_TABLES.CADENCE_SCHEDULE]: {
            required: true,
          },
        };
      } else andQuery.push({ status: req.query.status });
    }
    if (req.query.priority) andQuery.push({ priority: req.query.priority });
    if (req.query.user_id) andQuery.push({ user_id: req.query.user_id });
    if (req.query.sd_id) andQuery.push({ sd_id: req.query.sd_id });
    if (req.query.search) {
      const searchText = req.query.search.trim().toLowerCase();
      andQuery.push(
        sequelize.literal(`LOWER(Cadence.name) LIKE '%${searchText}%'`)
      );
    }
    if (req.query.created_at)
      andQuery.push({
        created_at: {
          [Op.lt]: req.query.created_at,
        },
      });

    if (req.query.updated_at)
      andQuery.push({
        updated_at: {
          [Op.lt]: req.query.updated_at,
        },
      });

    if (req.query.favorite)
      andQuery.push({
        favorite: parseInt(req.query.favorite),
      });

    if (
      req.user.integration_type === CRM_INTEGRATIONS.SHEETS &&
      req.query.move_to_another_cadence
    )
      andQuery.push({
        [Op.or]: [
          { integration_type: SHEETS_CADENCE_INTEGRATION_TYPE.EXCEL },
          {
            integration_type: null,
          },
        ],
      });

    query = {
      [Op.and]: andQuery,
    };

    let extrasQuery = {
      required: true,
      attributes: [
        'cadence_id',
        'description',
        'name',
        'status',
        'type',
        'priority',
        'user_id',
        'sd_id',
        'favorite',
        'company_id',
        'created_at',
        'updated_at',
        'integration_type',
        'salesforce_cadence_id',
        'inside_sales',
        'unix_resume_at',
        'salesforce_cadence_id',
      ],
      order: [['created_at', 'DESC']],
    };

    /**
     * Pagination
     * limit is used to specify number of cadences to fetch
     * offset is not used as it slows down sql query
     * we sort cadences based on their created_at or updated_at(for type=recent) in DESC order
     * so we accept created_at/updated_at in req query and we fetch no of cadences equal to 'limit' having their created_at/updated_at less than received created_at/updated_at
     **/

    if (req.query?.limit) extrasQuery.limit = parseInt(req.query.limit);
    if (req.query?.offset) extrasQuery.offset = parseInt(req.query.offset);

    let [cadences, errForCadence] = await Repository.fetchAll({
      tableName: DB_TABLES.CADENCE,
      query,
      include,
      extras: extrasQuery,
    });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: `Error while fetching cadences: ${errForCadence}`,
      });
    if (cadences.length === 0)
      return successResponse(res, 'No cadences found.', []);

    const result = cadences.map((obj) => {
      return {
        cadence_id: obj.cadence_id,
        description: obj.description,
        name: obj.name,
        status: obj.status,
        type: obj.type,
        priority: obj.priority,
        user_id: obj.user_id,
        favorite: obj.favorite,
        created_at: obj.created_at,
        updated_at: obj.updated_at,
        integration_type: obj.integration_type,
        salesforce_cadence_id: obj.salesforce_cadence_id,
        inside_sales: obj.inside_sales,
        unix_resume_at: obj.unix_resume_at,
        Cadence_Schedule: obj.Cadence_Schedule,
        steps: obj.Nodes?.length || 0,
        people: obj.LeadToCadences?.length || 0,
        owner: obj?.User
          ? `${obj?.User.first_name || ''} ${obj?.User.last_name || ''}`
          : '',
        sd_name:
          obj.User?.Sub_Department?.name ?? obj?.Sub_Department?.name ?? '',
        salesforce_cadence_id: obj?.salesforce_cadence_id,
      };
    });

    return successResponse(res, 'Cadences fetched successfully.', result);
  } catch (err) {
    logger.error(`Error while fetching cadences: `, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadences: ${err.message}`,
    });
  }
};

const getAllCadencesNameAndId = async (req, res) => {
  try {
    const body = cadenceSchema.fetchCadenceSchema.validate(req.query);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // User fetch for sd_id
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: 'User not found',
      });

    let query = {},
      andQuery = [],
      include = {};

    switch (req.query.type) {
      // Personal cadences
      case CADENCE_TYPES.PERSONAL:
        {
          andQuery.push(
            {
              user_id: user.user_id,
            },
            { type: CADENCE_TYPES.PERSONAL }
          );
          include = {
            [DB_TABLES.USER]: {
              where: { sd_id: user.sd_id },
              attributes: [],
              required: true,
            },
          };
        }
        break;

      // Company cadences
      case CADENCE_TYPES.COMPANY: {
        andQuery.push({ type: CADENCE_TYPES.COMPANY });
        include = {
          [DB_TABLES.COMPANY]: {
            attributes: [],
            where: { company_id: user.company_id },
            required: true,
          },
        };
        break;
      }

      case CADENCE_TYPES.RECENT: {
        include = {
          [DB_TABLES.SUB_DEPARTMENT]: {
            attributes: [],
            [DB_TABLES.DEPARTMENT]: {
              attributes: [],
              [DB_TABLES.COMPANY]: {
                attributes: [],
                where: { company_id: user.company_id },
                required: true,
              },
              required: true,
            },
            required: true,
          },
        };
        break;
      }
      // Deprecated
      // Team cadences
      case CADENCE_TYPES.TEAM:
        return badRequestResponseWithDevMsg({
          res,
          msg: `Something went wrong while fetching cadences`,
          error: `Team cadences not supported`,
        });
        {
          // Switch according to role
          switch (user.role) {
            case USER_ROLE.SALES_PERSON: {
              andQuery.push(
                { sd_id: user.sd_id },
                { type: CADENCE_TYPES.TEAM }
              );
              include = {
                [DB_TABLES.LEADTOCADENCE]: {
                  attributes: [],
                  [DB_TABLES.LEAD]: {
                    attributes: [],
                    where: { user_id: user.user_id },
                    required: true,
                  },
                  required: true,
                },
              };
              break;
            }
            case USER_ROLE.SALES_MANAGER: {
              andQuery.push(
                { sd_id: user.sd_id },
                { type: CADENCE_TYPES.TEAM }
              );
              include = {};
              break;
            }
            case USER_ROLE.SUPER_ADMIN:
            case USER_ROLE.ADMIN: {
              andQuery.push({ type: CADENCE_TYPES.TEAM });
              include = {
                [DB_TABLES.SUB_DEPARTMENT]: {
                  attributes: [],
                  [DB_TABLES.DEPARTMENT]: {
                    attributes: [],
                    [DB_TABLES.COMPANY]: {
                      where: { company_id: user.company_id },
                    },
                    required: true,
                  },
                  required: true,
                },
              };
              break;
            }
            default:
              return badRequestResponseWithDevMsg({
                res,
                msg: 'Not an appropriate role',
              });
          }
        }
        break;
    }

    if (req.query.status) andQuery.push({ status: req.query.status });
    if (req.query.priority) andQuery.push({ priority: req.query.priority });
    if (req.query.user_id) andQuery.push({ user_id: req.query.user_id });
    if (req.query.sd_id) andQuery.push({ sd_id: req.query.sd_id });
    if (req.query.search)
      andQuery.push(
        sequelize.where(sequelize.fn('lower', sequelize.col('Cadence.name')), {
          [Op.like]: `%${req.query.search.toLowerCase()}%`,
        })
      );

    query = {
      [Op.and]: andQuery,
    };

    let extrasQuery = {
      required: true,
      attributes: [
        'cadence_id',
        'name',
        'created_at',
        'user_id',
        'sd_id',
        'company_id',
      ],
      order:
        req.query.type === CADENCE_TYPES.RECENT
          ? [['updated_at', 'DESC']]
          : [['created_at', 'DESC']],
    };

    if (req.query?.limit && req.query.type !== CADENCE_TYPES.RECENT)
      extrasQuery.limit = parseInt(req.query.limit);
    if (req.query?.offset && req.query.type !== CADENCE_TYPES.RECENT)
      extrasQuery.offset = parseInt(req.query.offset);

    let [cadences, errForCadence] = await Repository.fetchAll({
      tableName: DB_TABLES.CADENCE,
      query,
      include,
      extras: extrasQuery,
    });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: `Error while fetching cadences: ${errForCadence}`,
      });
    if (cadences.length === 0)
      return successResponse(res, 'No cadences found.', []);

    if (req.query.type === CADENCE_TYPES.RECENT) {
      /* 
      if user is  SALES_PERSON, then remove all personal cadences that 
      do not belong to him and remove all cadences that do not belong to his team. 
      If user is SALES_MANAGER, he can view all cadences as 
      long as it belongs to his team and company. If the user is an ADMIN,
      he can see everything
    */
      recentCadences = [];

      for (let cadence of cadences) {
        if (
          cadence.user_id === user.user_id ||
          cadence.sd_id === user.sd_id ||
          cadence.company_id === user.company_id
        )
          recentCadences.push(cadence);

        if (recentCadences.length >= 10) break;
      }

      cadences = recentCadences;
    }

    return successResponse(res, 'Cadences fetched successfully.', cadences);
  } catch (err) {
    logger.error(`Error while fetching cadences: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadences: ${err.message}`,
    });
  }
};

const getCadence = async (req, res) => {
  try {
    const { id: cadence_id } = req.params;

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence',
        error: `Error while fetching user: ${errForUser}`,
      });

    // Retreive required cadence
    const [requiredCadence, errForRequiredCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.NODE]: {},
        [DB_TABLES.TAG]: {
          attributes: ['tag_name'],
        },
        [DB_TABLES.CADENCE_SCHEDULE]: {},
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: ['department_id'],
          [DB_TABLES.DEPARTMENT]: {
            attributes: ['company_id'],
          },
        },
      },
    });
    if (errForRequiredCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence',
        error: `Error while fetching user: ${errForRequiredCadence}`,
      });
    if (!requiredCadence)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence',
        error: 'Cadence not found',
      });

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence: requiredCadence,
      user,
      action: CADENCE_ACTIONS.READ,
    });
    if (errForAccess)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence',
        error: `Error while fetching access token: ${errForAccess}`,
      });
    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });

    let nodesInCadence = requiredCadence.Nodes;
    delete requiredCadence.Nodes;
    if (!nodesInCadence.length)
      return successResponse(res, 'Fetched cadence but no nodes present.', {
        ...requiredCadence,
        sequence: [],
      });

    // * sort all nodes in sequence
    const [nodesInSequence, errForNodesInSequence] =
      NodeHelper.getNodesInSequence(nodesInCadence);
    if (errForNodesInSequence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence',
        error: `Error while fetching node in sequence: ${nodesInSequence}`,
      });

    for (let node of nodesInSequence) {
      if (node.type === NODE_TYPES.AUTOMATED_MAIL) {
        // * since for automated mails multiple mail templates can be selected
        // * fetch attachments
        const [attachments, errForAttachments] = await Repository.fetchAll({
          tableName: DB_TABLES.ATTACHMENT,
          query: { attachment_id: node.data.attachments || [] },
        });

        // * replace attachment_ids with attachments
        node.data.attachments = attachments;
      } else if (node.type === NODE_TYPES.MAIL) {
        // * fetch attachments
        const [attachments, errForAttachments] = await Repository.fetchAll({
          tableName: DB_TABLES.ATTACHMENT,
          query: { attachment_id: node.data.attachments || [] },
        });

        // * replace attachment_ids with attachments
        node.data.attachments = attachments;
      } else if (
        [NODE_TYPES.REPLY_TO, NODE_TYPES.AUTOMATED_REPLY_TO].includes(node.type)
      ) {
        // * fetch attachments
        const [attachments, errForAttachments] = await Repository.fetchAll({
          tableName: DB_TABLES.ATTACHMENT,
          query: { attachment_id: node.data.attachments || [] },
        });

        // * replace attachment_ids with attachments
        node.data.attachments = attachments;
      }
    }

    const result = {
      ...requiredCadence,
      sequence: nodesInSequence,
    };

    // * return result
    return successResponse(res, 'Fetched cadence successfully.', result);
  } catch (err) {
    logger.error(`Error while fetching cadence sequence:  `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence sequence:  ${err.message}`,
    });
  }
};

const getAllLeadsForCadence = async (req, res) => {
  try {
    const body = cadenceSchema.fetchCadenceLeadsSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    const { cadence_id } = req.body;

    const userPromise = Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      extras: {
        attributes: ['user_id', 'sd_id', 'company_id', 'role'],
      },
    });
    // Get cadence info
    const cadencePromise = Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: ['department_id'],
          [DB_TABLES.DEPARTMENT]: {
            attributes: ['company_id'],
          },
        },
      },
      extras: {
        attributes: [
          'cadence_id',
          'name',
          'status',
          'type',
          'user_id',
          'sd_id',
          'company_id',
        ],
      },
    });
    const [[user, errForUser], [cadence, errForCadence]] = await Promise.all([
      userPromise,
      cadencePromise,
    ]);
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch leads for cadence',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'This cadence does not exist',
      });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch leads for cadence',
        error: `Error while fetching cadence: ${errForCadence}`,
      });

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence,
      user,
      action: CADENCE_ACTIONS.READ,
    });
    if (errForAccess)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch leads for cadence',
        error: `Error while checking cadence action access: ${errForAccess}`,
      });
    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });

    let where_query = [` where 1=1`];
    let limit_offset_query = [];

    let lead_to_cadence_status = [];

    // cadence_id is required
    where_query.push(`\`LeadsToCadence\`.\`cadence_id\` = :cadence_id`);

    if (req.body.status) {
      if (
        req.body.status === CADENCE_LEAD_STATUS.PAUSED &&
        cadence.status === CADENCE_STATUS.PAUSED
      )
        lead_to_cadence_status = [
          CADENCE_LEAD_STATUS.PAUSED,
          CADENCE_LEAD_STATUS.IN_PROGRESS,
        ];
      else if (
        cadence.status === CADENCE_STATUS.PAUSED &&
        req.body.status === CADENCE_LEAD_STATUS.PAUSED
      )
        lead_to_cadence_status = [CADENCE_LEAD_STATUS.IN_PROGRESS];
      else lead_to_cadence_status = [req.body.status];

      where_query.push(
        `\`LeadsToCadence\`.\`status\` in (:lead_to_cadence_status)`
      );
    }
    if (req.body.user_ids && req.body.user_ids?.length > 0)
      where_query.push(`\`Leads\`.\`user_id\` in (:user_ids)`);

    if (req.body.search)
      where_query.push(
        `LOWER(CONCAT(\`Leads\`.\`first_name\`, ' ',\`Leads\`.\`last_name\`)) LIKE :search_query`
      );

    if (req.body.limit)
      limit_offset_query.push(` LIMIT ${parseInt(req.body.limit)} `);

    if (req.body.offset)
      limit_offset_query.push(` OFFSET ${parseInt(req.body.offset)} `);

    if (req.body.created_at)
      where_query.push(`\`Leads\`.\`created_at\` < '${req.body.created_at}'`); // does not equal to because equal to was already sent in previous request

    where_query = where_query.join(' and ');
    limit_offset_query = limit_offset_query.join(' ');

    const replacements = {
      search_query: `%${req.body.search?.trim()?.toLowerCase()}%`,
      lead_to_cadence_status,
      user_ids: req.body.user_ids,
      where_query,
      cadence_id: req.body.cadence_id,
    };

    let sql_query = `

with \`paginated_leads\` as
( SELECT 
	\`LeadsToCadence\`.\`lead_cadence_id\`,
	\`LeadsToCadence\`.\`status\`,
	\`LeadsToCadence\`.\`unix_resume_at\` ,
	\`LeadsToCadence\`.\`created_at\` ,
	\`Leads\`.\`lead_id\` as \`Leads.lead_id\`,
	\`Leads\`.\`first_name\` as \`Leads.first_name\`,
	\`Leads\`.\`last_name\` as \`Leads.last_name\`,
	\`Leads\`.\`status\` as \`Leads.status\`,
	\`Leads\`.\`linkedin_url\` as \`Leads.linkedin_url\`,
	\`Leads\`.\`job_position\` as \`Leads.job_positioin\`,
	\`Leads\`.\`integration_id\` as \`Leads.integration_id\`,
	\`Leads\`.\`integration_type\` as \`Leads.integration_type\`,
	\`Leads\`.\`integration_status\` as \`Leads.integration_status\`,
	\`Leads\`.\`created_at\`  as \`Leads.created_at\`,
	\`Leads\`.\`user_id\`  as \`Leads.user_id\`,
	\`Leads\`.\`account_id\`  as \`Leads.account_id\`,
  \`Leads\`.\`lead_warmth\`  as \`Leads.lead_warmth\`,
  \`Leads\`.\`lead_score\`  as \`Leads.lead_score\`
from \`lead_to_cadence\` as \`LeadsToCadence\` inner join \`lead\` as \`Leads\` on \`Leads\`.\`lead_id\`=\`LeadsToCadence\`.\`lead_id\` 
${where_query}  order by \`Leads\`.\`lead_id\` DESC ${limit_offset_query}
)
select 
	paginated_leads.*,
	\`Account\`.\`account_id\` AS \`Leads.Account.account_id\`,
	\`Account\`.\`name\` AS \`Leads.Account.name\`,
	\`Account\`.\`phone_number\` AS \`Leads.Account.phone_number\`,
	\`Account\`.\`url\` AS \`Leads.Account.url\`,
	\`Account\`.\`integration_status\` AS \`Leads.Account.integration_status\`,
	\`Lead_phone_numbers\`.\`lpn_id\` AS \`Leads.Lead_phone_numbers.lpn_id\`,
	\`Lead_phone_numbers\`.\`phone_number\` AS \`Leads.Lead_phone_numbers.phone_number\`,
	\`Lead_phone_numbers\`.\`type\` AS \`Leads.Lead_phone_numbers.type\`,
	\`Lead_phone_numbers\`.\`is_primary\` AS \`Leads.Lead_phone_numbers.is_primary\`,
	\`Lead_emails\`.\`lem_id\` AS \`Leads.Lead_emails.lem_id\`,
	\`Lead_emails\`.\`email_id\` AS \`Leads.Lead_emails.email_id\`,
	\`Lead_emails\`.\`type\` AS \`Leads.Lead_emails.type\`,
	\`Lead_emails\`.\`is_primary\` AS \`Leads.Lead_emails.is_primary\`,
	\`User\`.\`first_name\` AS \`Leads.User.first_name\`,
	\`User\`.\`last_name\` AS \`Leads.User.last_name\`
from \`paginated_leads\`
	LEFT OUTER JOIN 
 \`account\` as \`Account\` on paginated_leads.\`Leads.account_id\` = \`Account\`.\`account_id\`
	LEFT OUTER JOIN \`lead_phone_number\` AS \`Lead_phone_numbers\` ON paginated_leads.\`Leads.lead_id\` = \`Lead_phone_numbers\`.\`lead_id\`
	LEFT OUTER JOIN \`lead_email\` AS \`Lead_emails\` ON paginated_leads.\`Leads.lead_id\` = \`Lead_emails\`.\`lead_id\`
	LEFT OUTER JOIN \`user\` AS \`User\` ON paginated_leads.\`Leads.user_id\` = \`User\`.\`user_id\`
	order by \`Leads.lead_id\` DESC

;
		`;

    //const options = {
    //hasJoin: true,
    //include: [
    //{
    //// include related models
    //model: DB_MODELS[DB_TABLES.LEAD],
    //include: [
    //{ model: DB_MODELS[DB_TABLES.ACCOUNT] },
    //{ model: DB_MODELS[DB_TABLES.LEAD_PHONE_NUMBER] },
    //{ model: DB_MODELS[DB_TABLES.LEAD_EMAIL] },
    //{ model: DB_MODELS[DB_TABLES.USER] },
    //],
    //},
    //],
    //logging: console.log,
    //};

    //DB_MODELS[DB_TABLES.LEADTOCADENCE]._validateIncludedElements(options);
    //let cadenceLeads = await sequelize.query(sql_query, {
    //raw: false,
    //nest: true,
    //replacements,
    //model: DB_MODELS[DB_TABLES.LEADTOCADENCE],
    //hasJoin: true,
    ////include: options.include,
    //...options,
    //mapToModel: true,
    //});
    let [cadenceLeads, errForCadenceLeads] = await Repository.runRawQuery({
      rawQuery: sql_query,
      tableName: DB_MODELS[DB_TABLES.LEADTOCADENCE],
      include: [
        {
          model: DB_MODELS[DB_TABLES.LEAD],
          include: [
            { model: DB_MODELS[DB_TABLES.ACCOUNT] },
            { model: DB_MODELS[DB_TABLES.LEAD_PHONE_NUMBER] },
            { model: DB_MODELS[DB_TABLES.LEAD_EMAIL] },
            { model: DB_MODELS[DB_TABLES.USER] },
          ],
        },
      ],
      replacements,
    });
    if (errForCadenceLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch leads for cadence',
        error: `Error while fetching leads for cadence: ${errForCadenceLeads}`,
      });
    return successResponse(res, `Fetched leads successfully.`, cadenceLeads);
  } catch (err) {
    console.log(err);
    logger.error(`Error while fetching leads for a cadence: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching leads for a cadence: ${err.message}`,
    });
  }
};

const getCadenceLeadsStats = async (req, res) => {
  try {
    const { cadence_id } = req.params;

    let query = { cadence_id };

    const [cadenceLeads, errForCadenceLeads] = await Repository.fetchAll({
      tableName: DB_TABLES.LEADTOCADENCE,
      query,
      include: {
        [DB_TABLES.LEAD]: {
          attributes: ['lead_id', 'user_id'],
          [DB_TABLES.USER]: {
            attributes: [
              'first_name',
              'last_name',
              'profile_picture',
              'is_profile_picture_present',
              'user_id',
              'sd_id',
            ],
            [DB_TABLES.SUB_DEPARTMENT]: {
              attributes: ['name', 'is_profile_picture_present'],
            },
          },
        },
      },
    });
    if (errForCadenceLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence leads stats: ',
        error: `Error while fetching cadence leads: ${errForCadenceLeads}`,
      });

    let owners = {};

    // * seperate leads from cadenceLeads
    cadenceLeads.map((cadenceLead) => {
      cadenceLead = JSON.parse(JSON.stringify(cadenceLead));
      if (cadenceLead.Leads && cadenceLead.Leads.length > 0) {
        const lead = cadenceLead.Leads[0];
        if (cadenceLead.Leads[0].User) {
          let userName = `${lead.User.first_name} ${lead.User.last_name}`;
          if (owners[userName]) owners[userName].count++;
          else {
            owners[userName] = {
              count: 1,
              user_id: lead.User.user_id,
              profile_picture: lead.User.profile_picture,
              is_profile_picture_present: lead.User.is_profile_picture_present,
              Sub_Department: lead.User.Sub_Department,
            };
          }
        }
      }
    });

    return successResponse(res, `Fetched leads successfully.`, {
      totalLeads: cadenceLeads.length,
      noOfOwners: Object.keys(owners).length,
      owners,
    });
  } catch (err) {
    logger.error(`Error while fetching cadence leads stats: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence leads stats: ${err.message}`,
    });
  }
};

const stopCurrentCadenceForLead = async (req, res) => {
  try {
    const body = cadenceSchema.stopCurrentCadenceForLeadSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    const { lead_id, cadence_id } = req.body;

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
    });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to stop current cadence for lead',
        error: `Error while fetching cadence: ${errForCadence}`,
      });
    if (!cadence)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to stop current cadence for lead',
        error: 'Cadence not found',
      });

    const [updateLeadToCadenceStatus, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.LEADTOCADENCE,
      query: { lead_id, cadence_id },
      updateObject: { status: CADENCE_LEAD_STATUS.STOPPED },
    });
    if (errForUpdate)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to stop current cadence for lead',
        error: `Error while updating: ${errForUpdate}`,
      });

    // Delete automatedTasks belonging to this lead and cadence
    AutomatedTasksHelper.deleteAutomatedTasks({ cadence_id, lead_id });

    // * Fetch latest task for lead
    const [task, errForTask] = await Repository.fetchOne({
      tableName: DB_TABLES.TASK,
      query: { lead_id, cadence_id, completed: false, is_skipped: false },
    });
    if (errForTask) return [null, errForTask];

    const [activityFromTemplate, errForActivityFromTemplate] =
      ActivityHelper.getActivityFromTemplates({
        type: ACTIVITY_TYPE.STOP_CADENCE,
        sub_type: ACTIVITY_SUBTYPES.LEAD,
        variables: {
          cadence_name: cadence.name,
          first_name: req?.user?.first_name || null,
          last_name: req?.user?.last_name || null,
        },
        activity: {
          lead_id: lead_id,
          incoming: null,
          node_id: task?.node_id ?? null,
        },
      });

    const [sendingActivity, errForSendingActivity] =
      await ActivityHelper.activityCreation(
        activityFromTemplate,
        req.user.user_id
      );

    WorkflowHelper.applyWorkflow({
      trigger: WORKFLOW_TRIGGERS.WHEN_A_CADENCE_IS_MANUALLY_STOPPED,
      cadence_id,
      lead_id,
    });

    return successResponse(res, 'Stopped cadence successfully.');
  } catch (err) {
    logger.error(`Error while stopping current cadence for lead: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while stopping current cadence for lead: ${err.message}`,
    });
  }
};

// DEPRECATED
//const getCadencesForTaskFilter = async (req, res) => {
//try {
//const [user, errForUser] = await Repository.fetchOne({
//tableName: DB_TABLES.USER,
//query: { user_id: req.user.user_id },
//});
//if (errForUser) return serverErrorResponse(res, errForUser);
//if (!user) return badRequestResponse(res, `No User found.`);

//let cadences = [],
//errForCadences = null;

//switch (user?.role) {
//case USER_ROLE.SALES_PERSON:
//[cadences, errForCadences] =
//await CadenceRepository.getCadencesByLeadQuery(
//{
//// cadence query
//status: CADENCE_STATUS.IN_PROGRESS,
////sd_id: user.sd_id, // should belong to user's sd_id
//},
//{
//// lead query
//user_id: user.user_id,
//},
//['name', 'cadence_id'], // cadence attributes
//[] // lead attributes
//);
//if (errForCadences) return serverErrorResponse(res, errForCadences);

//break;
//case USER_ROLE.SUPER_ADMIN:
//case USER_ROLE.ADMIN:
//[cadences, errForCadences] =
//await CadenceRepository.getCadencesByCreatedUserQuery(
//{}, // cadence query
//{ department_id: user.department_id }, // user query
//['name', 'cadence_id'], // cadence attributes
//[] // user attributes
//);
//if (errForCadences) return serverErrorResponse(res, errForCadences);

//break;
//case USER_ROLE.SALES_MANAGER_PERSON:
//case USER_ROLE.SALES_MANAGER:
//let teamAndPersonalCadencesPromise = Repository.fetchAll({
//tableName: DB_TABLES.CADENCE,
//query: {
//[Op.or]: [
//{
//sd_id: user.sd_id,
//},
//{
//'$User.sd_id$': user.sd_id,
//},
//],
//},
//include: {
//[DB_TABLES.USER]: {
//attributes: [],
//},
//},
//extras: {
//attributes: ['name', 'cadence_id'],
//},
//});

//let companyCadencesPromise = Repository.fetchAll({
//tableName: DB_TABLES.CADENCE,
//query: {
//type: CADENCE_TYPES.COMPANY,
//company_id: user.company_id,
//},
//extras: {
//attributes: ['name', 'cadence_id'],
//},
//});
//let companyCadences = [],
//errForCompanyCadences = null;
//[[cadences, errForCadences], [companyCadences, errForCompanyCadences]] =
//await Promise.all([
//teamAndPersonalCadencesPromise,
//companyCadencesPromise,
//]);
//if (errForCadences) return serverErrorResponse(res, errForCadences);

//cadences = cadences?.concat(companyCadences || []);

//break;
//}

//return successResponse(
//res,
//`Fetched cadences for user successfully.`,
//cadences
//);
//} catch (err) {
//logger.error(`Error while fething cadences for task filter: `, err);
//return serverErrorResponse(
//res,
//`Error while fething cadences for task filter: ${err.message}.`
//);
//}
//};

const getCadencesForTaskFilter = async (req, res) => {
  try {
    // Step: Validate req body using joi
    const body = cadenceSchema.cadencesForTaskFilterSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // Step: Destructure body variables
    let { user_id, limit, offset, type, search } = req.body;

    // Step: If no user_id is passed use the requesting user's user_id
    if (!user_id) user_id = req?.user?.user_id;

    // Step: Set default values if not provided
    if (!limit) limit = 20;
    if (!offset) offset = 0;

    // Step: set up cadenceAndQuery for type and search, if provided
    let cadenceAndQuery = [{ type }];
    if (search)
      cadenceAndQuery.push(
        sequelize.where(
          sequelize.fn('lower', sequelize.col('Task.Cadence.name')),
          {
            [Op.like]: `%${search?.toLowerCase()}%`,
          }
        )
      );

    // Step: Fetch required cadences
    const [cadences, errForCadences] = await Repository.fetchAll({
      tableName: DB_TABLES.DAILY_TASKS,
      query: {
        user_id,
      },
      include: {
        [DB_TABLES.TASK]: {
          where: {
            completed: {
              [Op.ne]: 1,
            },
          },
          required: true,
          attributes: ['cadence_id'],
          [DB_TABLES.CADENCE]: {
            where: {
              [Op.and]: cadenceAndQuery,
            },
            attributes: ['name', 'type'],
            required: true,
          },
        },
      },
      extras: {
        attributes: ['task_id'],
        //logging: console.log,
        order: [[{ model: Task }, 'cadence_id']],
        group: ['Task.cadence_id'],
        limit,
        offset,
      },
    });
    if (errForCadences)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences in filter',
        error: `Failed to fetch cadences in filter: ${errForCadences}`,
      });

    return successResponse(
      res,
      `Fetched cadences for task filter successfully.`,
      cadences
    );
  } catch (err) {
    logger.error(`Error while fething cadences for task filter: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fething cadences for task filter: ${err.message}.`,
    });
  }
};

const getCadencesForLeadFilter = async (req, res) => {
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: `No User found`,
      });

    let cadences = [],
      errForCadences = null;

    [cadences, errForCadences] = await CadenceRepository.getCadencesByLeadQuery(
      {
        // cadence query
        status: CADENCE_STATUS.IN_PROGRESS,
      },
      {
        // lead query
        user_id: user.user_id,
      },
      ['name', 'cadence_id'], // cadence attributes
      [] // lead attributes
    );
    if (errForCadences)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: `Error while fetching cadences by lead query: ${errForCadences}`,
      });

    return successResponse(
      res,
      `Fetched cadences for user successfully.`,
      cadences
    );
  } catch (err) {
    logger.error(`Error while fething cadences for lead filter: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fething cadences for lead filter: ${err.message}.`,
    });
  }
};

const duplicateCadence = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const body = cadenceSchema.duplicateCadenceSchema.validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    const { cadence_id } = req.body;
    const { integration_type } = req.user;

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      t,
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create duplicate cadence',
        error: `Error while fetching user: ${errForUser}`,
      });
    }

    const [ogCadence, errForOgCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
        [DB_TABLES.SUB_DEPARTMENT]: {
          [DB_TABLES.DEPARTMENT]: { attributes: ['company_id'] },
          attributes: ['sd_id', 'department_id'],
        },
      },
      t,
    });
    if (errForOgCadence) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create duplicate cadence',
        error: `Error while fetching cadence: ${errForOgCadence}`,
      });
    }
    if (!ogCadence) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create duplicate cadence',
        error: `No cadence found`,
      });
    }
    //if (ogCadence?.name?.trim() === req.body?.name?.trim()) {
    //t.rollback();
    //return badRequestResponse(
    //res,
    //`A cadence with same name exists, please use another name.`
    //);
    //}

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence: req.body,
      user,
      action: CADENCE_ACTIONS.DUPLICATE,
      data: { ogCadence },
    });
    if (errForAccess) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create duplicate cadence',
        error: `Error while checking cadence action access: ${errForAccess}`,
      });
    }
    if (!access) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });
    }

    req.body.status = CADENCE_STATUS.NOT_STARTED;
    req.body.user_id = req.user.user_id;
    req.body.company_id = req.user.company_id;
    req.body.name = req.body.name?.trim();
    delete req.body.cadence_id;
    if (req.user.integration_type === CRM_INTEGRATIONS.SHEETS)
      req.body.integration_type = null;

    // * create a cadence
    const [cadence, errForCadence] = await Repository.create({
      tableName: DB_TABLES.CADENCE,
      createObject: req.body,
      t,
    });
    if (errForCadence) {
      t.rollback();
      if (errForCadence.includes('uniqueCadenceNamePerCompany must be unique'))
        return badRequestResponseWithDevMsg({
          res,
          msg: `A cadence with same name exists, please use another name`,
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create duplicate cadence',
        error: `Error while creating cadence: ${errForCadence}`,
      });
    }

    // let tags = req.body.tags;
    // for (let tag of tags) tag.cadence_id = cadence.cadence_id;

    // const [createdTags, errForTags] = await Repository.bulkCreate({
    //   tableName: DB_TABLES.TAG,
    //   createObject: tags,
    //   t,
    // });
    // if (errForTags) {
    //   t.rollback();
    //   return serverErrorResponseWithDevMsg({
    //     res,
    //     msg: 'Failed to create duplicate cadence',
    //     error: `Error while creating tags: ${errForTags}`,
    //   });
    // }
    // cadence.tags = createdTags;

    const [nodes, errForNodes] = await Repository.fetchAll({
      tableName: DB_TABLES.NODE,
      query: { cadence_id },
      t,
      extras: {
        order: ['step_number'],
      },
    });
    if (errForNodes) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create duplicate node',
        error: `Error while fetching nodes: ${errForNodes}`,
      });
    }

    let previousNode = null;
    let oldToNewNodeMapping = {};
    for (let node of nodes) {
      node.cadence_id = cadence.cadence_id;
      let oldNodeId = node.node_id;
      delete node?.node_id;
      delete node?.next_node_id;
      delete node?.step_number;
      delete node?.is_first;
      delete node?.created_at;
      delete node?.updated_at;

      if (
        [NODE_TYPES.REPLY_TO, NODE_TYPES.AUTOMATED_REPLY_TO].includes(
          node.type
        ) &&
        node?.data?.replied_node_id
      )
        node.data.replied_node_id =
          oldToNewNodeMapping[node.data.replied_node_id];

      if (
        [
          NODE_TYPES.MAIL,
          NODE_TYPES.REPLY_TO,
          NODE_TYPES.AUTOMATED_REPLY_TO,
        ].includes(node.type) &&
        node.data?.aBTestEnabled === true
      ) {
        let templates = node.data.templates;

        for (let i = 0; i < templates.length; i++)
          node.data.templates[i].ab_template_id = uuidv4();
      }

      // * create a node
      const [createdNode, errForNode] = await CadenceHelper.addNodeToCadence(
        node,
        previousNode?.node_id
      );
      previousNode = createdNode;
      oldToNewNodeMapping[oldNodeId] = createdNode.node_id;
    }

    // Sharing Workflows
    if (req.body?.is_workflow) {
      const [workflows, errForWorkflow] = await Repository.fetchAll({
        tableName: DB_TABLES.WORKFLOW,
        query: {
          cadence_id: cadence_id,
          company_id: req.user.company_id,
        },
        t,
      });
      if (errForWorkflow) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: `Failed to fetch workflow`,
          error: `Error while fetching workflow: ${errForWorkflow}`,
        });
      }

      for (let workflow of workflows) {
        workflow.cadence_id = cadence.cadence_id;
        delete workflow?.workflow_id;
        delete workflow?.created_at;
        delete workflow?.updated_at;

        // * create a workflow
        const [createdWorkflow, errForCreatingWorkflow] =
          await Repository.create({
            tableName: DB_TABLES.WORKFLOW,
            createObject: workflow,
            t,
          });
        if (errForCreatingWorkflow) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: `Failed to share cadence`,
            error: `Error while creating workflow: ${errForWorkflow}`,
          });
        }
      }
    }

    switch (integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE: {
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });
        if (
          [
            'Please log in with salesforce',
            'Error while getting access token and refresh token from salesforce auth',
            'Kindly log in with salesforce.',
          ].includes(errForAccessToken)
        ) {
          t.rollback();
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Kindly log in to salesforce to create a cadence',
          });
        }
        // Creating cadence in salesforce
        const [salesforceCadence, errForSfCadence] =
          await SalesforceService.createCadence(
            cadence,
            access_token,
            instance_url
          );
        if (errForSfCadence) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to create duplicate cadence',
            error: `Error while creating cadence in salesforce: ${errForSfCadence}`,
          });
        }
        // Updating salesforce cadence id in db
        if (salesforceCadence) {
          [updatedCadence, errForUpdate] = await Repository.update({
            tableName: DB_TABLES.CADENCE,
            updateObject: { salesforce_cadence_id: salesforceCadence },
            query: { cadence_id: cadence.cadence_id },
            t,
          });
          if (errForUpdate) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to create duplicate cadence',
              error: `Error while updating salesforce cadence id: ${err.message}`,
            });
          }
        }
        break;
      }
      default: {
        logger.info('No requirement.');
        break;
      }
    }

    t.commit();

    return successResponse(res, 'Cadence created successfully', cadence);
  } catch (err) {
    t.rollback();
    logger.error(`Error while creating a duplicate cadence: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating a duplicate cadence: ${err.message}`,
    });
  }
};

const deleteManyCadence = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // cadences: Array<cadence_id>
    const body = cadenceSchema.deleteManyCadenceSchema.validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    const { cadence_ids } = req.body;

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      t,
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete cadences',
        error: `Error while fetching user: ${errForUser}`,
      });
    }

    const [cadences, errForCadences] = await Repository.fetchAll({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id: cadence_ids },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
      },
      t,
    });
    if (cadences.length !== cadence_ids.length) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to delete cadences',
        msg: `Not all the cadences were found`,
      });
    }
    if (errForCadences) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete cadences',
        error: `Error while fetching cadences: ${errForCadences}`,
      });
    }

    // Checking if any of the cadence is in progress
    cadences.forEach((cadence) => {
      if (cadence.status === CADENCE_STATUS.IN_PROGRESS) {
        t.rollback();
        return badRequestResponseWithDevMsg({
          res,
          msg: `${cadence.name} is in progress`,
        });
      }
    });

    const [_, err] = await CadenceRepository.deleteCadencesByQuery({
      cadence_id: cadence_ids,
    });
    if (err) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete cadences',
        error: `Error while deleting cadences by query: ${err}`,
      });
    }

    const [automatedTasks, errForAutomatedTasks] = await Repository.fetchAll({
      tableName: DB_TABLES.AUTOMATED_TASKS,
      query: {},
      include: {
        [DB_TABLES.TASK]: {
          where: {
            cadence_id: {
              [Op.in]: cadence_ids,
            },
          },
          required: true,
        },
      },
    });

    const automatedTasksIds = automatedTasks?.map((at) => at.at_id) || [];

    // Deleteting all nodes, tags, tasks and leadToCadences
    const [
      [_node, nodeError],
      [_tag, tagError],
      [_task, taskError],
      [_leadToCadence, leadToCadenceError],
      [deleteForAutomatedTasks, errForDeleteAutomatedTasks],
    ] = await Promise.all([
      Repository.destroy({
        tableName: DB_TABLES.NODE,
        query: { cadence_id: cadence_ids },
      }),
      Repository.destroy({
        tableName: DB_TABLES.TAG,
        query: { cadence_id: cadence_ids },
      }),
      Repository.destroy({
        tableName: DB_TABLES.TASK,
        query: { cadence_id: cadence_ids },
      }),
      Repository.destroy({
        tableName: DB_TABLES.LEADTOCADENCE,
        query: { cadence_id: cadence_ids },
      }),
      Repository.destroy({
        tableName: DB_TABLES.AUTOMATED_TASKS,
        query: {
          at_id: automatedTasksIds,
        },
      }),
    ]);
    if (
      nodeError ||
      tagError ||
      taskError ||
      leadToCadenceError ||
      errForDeleteAutomatedTasks
    ) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete cadences',
        error: `Error while deleteting all nodes, tags, tasks and leadToCadences: ${
          nodeError ||
          tagError ||
          taskError ||
          leadToCadenceError ||
          errForDeleteAutomatedTasks
        }`,
      });
    }

    t.commit();

    // Deleting cadences from salesforce if possible
    const salesforce_cadence_to_delete = [];
    let access_token, instance_url, errForAccessToken;
    cadences.forEach(async (cadence) => {
      if (cadence.salesforce_cadence_id) {
        if (!access_token)
          [{ access_token, instance_url }, errForAccessToken] =
            await AccessTokenHelper.getAccessToken({
              integration_type: CRM_INTEGRATIONS.SALESFORCE,
              user_id: req.user.user_id,
            });
        if (
          [
            'Kindly sign in with your crm.',
            'Kindly log in with salesforce.',
            'Error while getting access token and refresh token from salesforce auth',
          ].includes(errForAccessToken)
        )
          return successResponse(
            res,
            'Cadence deleted in the tool. To delete in salesforce, kindly login.'
          );

        req.body.salesforce_cadence_id = cadence.salesforce_cadence_id;
        salesforce_cadence_to_delete.push(
          await SalesforceService.deleteCadence(
            { ...req.body },
            access_token,
            instance_url
          )
        );
      }
    });
    if (salesforce_cadence_to_delete.length > 0) {
      await Promise.all(salesforce_cadence_to_delete);
    }

    return successResponse(res, 'Cadence deleted successfully.');
  } catch (err) {
    t.rollback();
    logger.error(`Error while deleting cadences: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting cadences: ${err.message}`,
    });
  }
};

const shareCadence = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const body = cadenceSchema.shareCadenceSchema.validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    const { cadence_id, is_workflow, name } = req.body;
    const { integration_type } = req.user;
    req.body.name = req.body.name?.trim();
    delete req.body.cadence_id;
    delete req.body.is_workflow;

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      t,
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to share cadence',
        error: `Error while fetching user: ${errForUser}`,
      });
    }

    const [ogCadence, errForOgCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
        [DB_TABLES.SUB_DEPARTMENT]: {
          [DB_TABLES.DEPARTMENT]: { attributes: ['company_id'] },
          attributes: ['sd_id', 'department_id'],
        },
      },
      t,
    });
    if (errForOgCadence) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to share cadence',
        error: `Error while fetching cadence: ${errForOgCadence}`,
      });
    }
    if (!ogCadence) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to share cadence',
        error: `No cadence found`,
      });
    }

    let toShareUser,
      errToShareUser,
      toShareSubDepartment,
      errToShareSubDepartment;

    req.body.status = CADENCE_STATUS.NOT_STARTED;
    req.body.company_id = req.user.company_id;
    if (req.user.integration_type === CRM_INTEGRATIONS.SHEETS)
      req.body.integration_type = null;
    let sharedCadences = [];
    switch (req.body.type) {
      case CADENCE_TYPES.PERSONAL:
        if (req.body.user_ids.includes(req.user.user_id)) {
          t.rollback();
          return badRequestResponseWithDevMsg({
            res,
            msg: 'You cannot share a cadence with yourself',
          });
        }

        // Fetching users to share a cadence
        [toShareUser, errToShareUser] = await Repository.fetchAll({
          tableName: DB_TABLES.USER,
          query: {
            user_id: {
              [Op.in]: req.body.user_ids,
            },
          },
          t,
        });
        if (errToShareUser) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to share cadence',
            error: `Error while fetching user: ${errToShareUser}`,
          });
        }

        // Checking if user is present in tool or not
        let userNotPresentArray = [];
        for (const element of toShareUser) {
          if (!req.body.user_ids.includes(element.user_id)) {
            userNotPresentArray.push(element);
          }
        }
        if (userNotPresentArray.length > 0) {
          t.rollback();
          return badRequestResponseWithDevMsg({
            res,
            msg: `User does not exist`,
            error: `User does not exist: ${userNotPresentArray}`,
          });
        }
        req.body.sd_id = null;
        delete req.body.user_ids;
        delete req.body.sd_ids;

        // sharing cadence to users
        let [shareCadenceToUser, errWhileSharingCadenceToUser] =
          await CadenceHelper.shareCadenceToUsers({
            cadence_id,
            user,
            object: req.body,
            is_workflow,
            toShareUser,
            ogCadence,
          });
        if (errWhileSharingCadenceToUser) {
          t.rollback();
          if (
            errWhileSharingCadenceToUser?.error?.includes(
              'uniqueCadenceNamePerCompany must be unique'
            )
          )
            return serverErrorResponseWithDevMsg({
              res,
              msg: `Cadence with name '${errWhileSharingCadenceToUser?.name}' already exists. Please use another name`,
            });

          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to share cadence',
            error: `Error while sharing cadence to users: ${errWhileSharingCadenceToUser?.error}`,
          });
        }
        sharedCadences = shareCadenceToUser;
        break;

      case CADENCE_TYPES.TEAM:
        return badRequestResponseWithDevMsg({
          res,
          msg: `Something went wrong while sharing cadence`,
          error: `Team cadences not supported`,
        });
        if (req.body.sd_ids.includes(req.user.sd_id)) {
          t.rollback();
          return badRequestResponseWithDevMsg({
            res,
            msg: 'You cannot share a cadence with same group',
          });
        }

        // Fetching groups to share a cadence
        [toShareSubDepartment, errToShareSubDepartment] =
          await Repository.fetchAll({
            tableName: DB_TABLES.SUB_DEPARTMENT,
            query: {
              sd_id: {
                [Op.in]: req.body.sd_ids,
              },
            },
            include: {
              [DB_TABLES.DEPARTMENT]: { [DB_TABLES.COMPANY]: {} },
            },
            t,
          });
        if (errToShareSubDepartment) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to share cadence',
            error: `Error while fetching sub department: ${errToShareSubDepartment}`,
          });
        }

        // Checking if group is present in tool or not
        let sdNotPresent = [];
        for (const element of toShareSubDepartment) {
          if (!req.body.sd_ids.includes(element.sd_id)) {
            sdNotPresent.push(element);
          }
        }

        if (!toShareSubDepartment) {
          t.rollback();
          return badRequestResponseWithDevMsg({
            res,
            msg: `Sub department does not exist`,
            error: `Sub department does not exist: ${sdNotPresent}`,
          });
        }

        req.body.user_id = req.user.user_id;
        delete req.body.user_ids;
        delete req.body.sd_ids;

        // sharing cadence to groups
        let [shareCadenceToGroups, errWhileSharingCadenceToGroups] =
          await CadenceHelper.shareCadenceToGroups(
            {
              cadence_id,
              user,
              object: req.body,
              is_workflow,
              toShareSubDepartment,
              ogCadence,
            },
            t
          );
        if (errWhileSharingCadenceToGroups) {
          t.rollback();
          if (
            errWhileSharingCadenceToGroups?.error.includes(
              'uniqueCadenceNamePerCompany must be unique'
            )
          )
            return serverErrorResponseWithDevMsg({
              res,
              msg: `Cadence with name '${errWhileSharingCadenceToGroups?.name}' already exists. Please use another name`,
            });

          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to share cadence',
            error: `Error while sharing cadence to groups: ${errWhileSharingCadenceToGroups?.error}`,
          });
        }
        sharedCadences = shareCadenceToGroups;
        break;

      case CADENCE_TYPES.COMPANY:
        req.body.user_id = req.user.user_id;
        req.body.sd_id = null;
        delete req.body.user_ids;
        delete req.body.sd_ids;
        let [shareCadencetoCompany, errWhileCreatingCadence] =
          await CadenceHelper.shareCadenceToCompany(
            {
              cadence_id,
              user,
              object: req.body,
              is_workflow,
              ogCadence,
            },
            t
          );
        if (errWhileCreatingCadence) {
          t.rollback();
          if (
            errWhileCreatingCadence?.error?.includes(
              'uniqueCadenceNamePerCompany must be unique'
            )
          )
            return serverErrorResponseWithDevMsg({
              res,
              msg: `Cadence with name '${errWhileCreatingCadence?.name}' already exists. Please use another name`,
            });
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to share cadence',
            error: `Error while sharing cadence: ${errWhileCreatingCadence?.error}`,
          });
        }
        sharedCadences = shareCadencetoCompany;
        break;

      default:
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to share cadence',
          err: `Invalid Cadence Type`,
        });
    }

    switch (integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE: {
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });
        if (
          [
            'Please log in with salesforce',
            'Error while getting access token and refresh token from salesforce auth',
            'Kindly log in with salesforce.',
          ].includes(errForAccessToken)
        ) {
          t.rollback();
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Kindly log in to salesforce to create a cadence',
          });
        }
        for (let i = 0; i < sharedCadences.length; i++) {
          // Creating cadence in salesforce
          const [salesforceCadence, errForSfCadence] =
            await SalesforceService.createCadence(
              sharedCadences[i],
              access_token,
              instance_url
            );
          if (errForSfCadence) {
            t.rollback();
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to share cadence',
              error: `Error while creating cadence in salesforce: ${errForSfCadence}`,
            });
          }

          // Updating salesforce cadence id in db
          if (salesforceCadence) {
            [updatedCadence, errForUpdate] = await Repository.update({
              tableName: DB_TABLES.CADENCE,
              updateObject: { salesforce_cadence_id: salesforceCadence },
              query: { cadence_id: sharedCadences[i].cadence_id },
              t,
            });
            if (errForUpdate) {
              t.rollback();
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to share cadence',
                error: `Error while updating salesforce cadence id: ${errForUpdate}`,
              });
            }
          }
        }
        break;
      }
      default: {
        logger.info('CRM created not required.');
        break;
      }
    }

    t.commit();
    return successResponse(res, 'Cadence shared successfully');
  } catch (err) {
    t.rollback();
    logger.error(`Error while creating a shared cadence: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating a shared cadence: ${err.message}`,
    });
  }
};

const checkWorkflowInCadence = async (req, res) => {
  try {
    const { cadence_id } = req.params;
    let [workFlowCount, errForWorkflow] = await Repository.count({
      tableName: DB_TABLES.WORKFLOW,
      query: {
        cadence_id: cadence_id,
      },
    });
    if (errForWorkflow)
      return serverErrorResponseWithDevMsg({
        msg: 'Failed to check workflow',
        error: `Error while fetching workflow count: ${errForWorkflow}`,
      });
    return successResponse(res, 'Fetched workflow count', {
      workFlowCount: workFlowCount,
    });
  } catch (err) {
    logger.error(`Error while fetching cadence workflow count: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence workflow count: ${err.message}`,
    });
  }
};

const getCadenceStatistics = async (req, res) => {
  try {
    const { cadence_id } = req.params;

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: {
        cadence_id,
      },
      include: {
        [DB_TABLES.NODE]: {
          order: ['step_number'],
        },
      },
      extras: {
        attributes: [],
        order: [['Nodes', 'step_number', 'ASC']],
      },
    });

    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence statistics',
        error: `Error while fetching cadence: ${errForCadence}`,
      });
    if (!cadence)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence statistics',
        error: 'Cadence not found',
      });

    const [cadenceLeads, errForCadenceLeads] = await Repository.count({
      tableName: DB_TABLES.LEADTOCADENCE,
      query: { cadence_id },
    });
    if (errForCadenceLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence statistics',
        error: `Error while fetching lead to cadence: ${errForCadenceLeads}`,
      });

    // * fetch user
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence statistics',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence statistics',
        error: `User not found`,
      });

    // * total leads

    const nodes = cadence?.Nodes;

    if (!nodes || nodes?.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        error: `No nodes present`,
      });

    // * result to return
    let result = {
      cadenceName: cadence?.name,
      metrics: {
        totalLeads: cadenceLeads || 0,
      },
      nodeStats: [],
    };

    const currentTimeInUnix = new Date().getTime();

    const node_ids = [];

    for (const node of nodes) node_ids.push(node.node_id);

    const node_ids_sql = ` (${node_ids?.join(',')}) `;

    const statsRawQueryPromise = CadenceHelper.getCadenceStepStatistics(
      node_ids_sql,
      currentTimeInUnix
    );

    const nodePromises = [];
    // * loop for all nodes
    for (let node of nodes) {
      // Find all the leads that are on the current node step

      switch (node.type) {
        case NODE_TYPES.MAIL:
        case NODE_TYPES.AUTOMATED_MAIL:
        case NODE_TYPES.REPLY_TO:
        case NODE_TYPES.AUTOMATED_REPLY_TO:
          if (node.data?.aBTestEnabled) {
            const abTestPromise = Repository.fetchAll({
              tableName: DB_TABLES.A_B_TESTING,
              query: {
                node_id: node.node_id,
              },
              include: {
                [DB_TABLES.EMAIL]: {
                  attributes: [],
                  required: true,
                  [DB_TABLES.LEAD]: {
                    required: true,
                    attributes: [],
                    [DB_TABLES.USER]: {
                      required: true,
                      attributes: [],
                    },
                  },
                },
              },
              extras: {
                // logging: true,
                group: ['ab_template_id'],
                attributes: [
                  'ab_template_id',
                  [
                    sequelize.literal(`COUNT(DISTINCT email.lead_id, CASE
                          WHEN email.unsubscribed = 1 AND email.node_id=${node.node_id}
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'unsubscribed_count',
                  ],
                  [
                    sequelize.literal(`COUNT(DISTINCT email.lead_id,CASE
                          WHEN email.status IN ("${EMAIL_STATUS.DELIVERED}", "${EMAIL_STATUS.OPENED}", "${EMAIL_STATUS.CLICKED}") 
                          AND email.sent=1 
                          AND email.node_id=${node.node_id}
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'delivered_count',
                  ],
                  [
                    sequelize.literal(`COUNT(DISTINCT email.lead_id,CASE
                          WHEN email.status IN ("${EMAIL_STATUS.DELIVERED}", "${EMAIL_STATUS.OPENED}")
                          AND email.sent=0
                          AND email.node_id=${node.node_id}
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'replied_count',
                  ],
                  [
                    sequelize.literal(`COUNT(DISTINCT email.lead_id,CASE
                          WHEN email.status IN ("${EMAIL_STATUS.OPENED}", "${EMAIL_STATUS.CLICKED}") 
                          AND email.sent=1
                          AND email.node_id=${node.node_id}
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'opened_count',
                  ],
                  [
                    sequelize.literal(`COUNT(DISTINCT email.lead_id,CASE
                          WHEN email.status IN ("${EMAIL_STATUS.CLICKED}") 
                          AND email.sent=1
                          AND email.node_id=${node.node_id}
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'clicked_count',
                  ],
                  [
                    sequelize.literal(`COUNT(DISTINCT email.lead_id,CASE
                          WHEN email.status IN ("${EMAIL_STATUS.BOUNCED}")
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'bounced_count',
                  ],
                ],
              },
            });
            nodePromises.push(abTestPromise);
            // result['nodeStats'].push({
            //   name: node.name,
            //   node_id: node.node_id,
            //   aBTestEnabled: true,
            //   data: templateMails,
            //   leadsOnCurrentNode,
            //   pausedLeads,
            //   doneAndSkippedTasksForCurrentNode,
            //   disqualifedAndConvertedLeads,
            // });
          } else {
            const emailPromise = Repository.fetchAll({
              tableName: DB_TABLES.EMAIL,
              query: { node_id: node.node_id },
              attributes: [],
              include: {
                [DB_TABLES.LEAD]: {
                  required: true,
                  attributes: [],
                  [DB_TABLES.USER]: {
                    required: true,
                    attributes: [],
                  },
                },
              },
              extras: {
                // group: ['Email.lead_id'],
                attributes: [
                  [
                    sequelize.literal(`COUNT(DISTINCT email.lead_id, CASE
                          WHEN email.unsubscribed = 1 AND email.sent=1
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'unsubscribed_count',
                  ],
                  [
                    sequelize.literal(`COUNT(DISTINCT email.lead_id,CASE
                          WHEN email.status IN ("${EMAIL_STATUS.DELIVERED}", "${EMAIL_STATUS.OPENED}", "${EMAIL_STATUS.CLICKED}") AND email.sent=1
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'delivered_count',
                  ],
                  [
                    sequelize.literal(`COUNT(DISTINCT email.lead_id,CASE
                          WHEN email.status IN ("${EMAIL_STATUS.DELIVERED}", "${EMAIL_STATUS.OPENED}") AND email.sent=0
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'replied_count',
                  ],
                  [
                    sequelize.literal(`COUNT(DISTINCT email.lead_id,CASE
                          WHEN email.status IN ("${EMAIL_STATUS.OPENED}", "${EMAIL_STATUS.CLICKED}") AND email.sent=1
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'opened_count',
                  ],
                  [
                    sequelize.literal(`COUNT(DISTINCT email.lead_id,CASE
                          WHEN email.status IN ("${EMAIL_STATUS.CLICKED}") AND email.sent=1
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'clicked_count',
                  ],
                  [
                    sequelize.literal(`COUNT(DISTINCT email.lead_id,CASE
                          WHEN email.status IN ("${EMAIL_STATUS.BOUNCED}") AND email.sent=1
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'bounced_count',
                  ],
                ],
              },
            });

            nodePromises.push(emailPromise);

            // result['nodeStats'].push({
            //   name: node.name,
            //   node_id: node.node_id,
            //   data: mails,
            //   leadsOnCurrentNode,
            //   pausedLeads,
            //   doneAndSkippedTasksForCurrentNode,
            //   disqualifedAndConvertedLeads,
            // });
          }
          break;
        case NODE_TYPES.MESSAGE:
        case NODE_TYPES.AUTOMATED_MESSAGE:
          if (node.data?.aBTestEnabled) {
            const abTestPromise = Repository.fetchAll({
              tableName: DB_TABLES.A_B_TESTING,
              query: {
                node_id: node.node_id,
              },
              include: {
                [DB_TABLES.MESSAGE]: {
                  attributes: [],
                  required: true,
                  [DB_TABLES.LEAD]: {
                    required: true,
                    attributes: [],
                    [DB_TABLES.USER]: {
                      required: true,
                      attributes: [],
                    },
                  },
                },
              },
              extras: {
                group: ['ab_template_id'],
                attributes: [
                  'ab_template_id',
                  [
                    sequelize.literal(`COUNT(DISTINCT message.lead_id,CASE
                          WHEN message.status IN ("${SMS_STATUS.DELIVERED}", "${SMS_STATUS.CLICKED}") AND message.sent=1
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'delivered_count',
                  ],
                  [
                    sequelize.literal(`COUNT(DISTINCT message.lead_id,CASE
                          WHEN message.status IN ("${SMS_STATUS.CLICKED}") AND message.sent=1
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'clicked_count',
                  ],
                ],
              },
            });

            nodePromises.push(abTestPromise);

            // result['nodeStats'].push({
            //   name: node.name,
            //   node_id: node.node_id,
            //   aBTestEnabled: true,
            //   data: templateMessages,
            //   leadsOnCurrentNode,
            //   pausedLeads,
            //   doneAndSkippedTasksForCurrentNode,
            //   disqualifedAndConvertedLeads,
            // });
          } else {
            const messagePromise = Repository.fetchAll({
              tableName: DB_TABLES.MESSAGE,
              query: { node_id: node.node_id },
              attributes: [],
              include: {
                [DB_TABLES.LEAD]: {
                  required: true,
                  attributes: [],
                  [DB_TABLES.USER]: {
                    required: true,
                    attributes: [],
                  },
                },
              },
              extras: {
                // group: ['Message.lead_id'],
                attributes: [
                  [
                    sequelize.literal(`COUNT(DISTINCT message.lead_id,CASE
                          WHEN message.status IN ("${SMS_STATUS.DELIVERED}", "${SMS_STATUS.CLICKED}") AND message.sent=1
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'delivered_count',
                  ],

                  [
                    sequelize.literal(`COUNT(DISTINCT message.lead_id,CASE
                          WHEN message.status IN ("${SMS_STATUS.CLICKED}") AND message.sent=1
                            THEN 1
                            ELSE NULL
                          END ) `),
                    'clicked_count',
                  ],
                ],
              },
            });
            nodePromises.push(messagePromise);

            // result['nodeStats'].push({
            //   name: node.name,
            //   node_id: node.node_id,
            //   data: messages,
            //   leadsOnCurrentNode,
            //   pausedLeads,
            //   doneAndSkippedTasksForCurrentNode,
            //   disqualifedAndConvertedLeads,
            // });
          }
          break;
        case NODE_TYPES.END:
          if (node.data?.moved_leads) {
            const movedLeadsPromise = Repository.fetchAll({
              tableName: DB_TABLES.LEAD,
              query: {
                lead_id: node.data?.moved_leads,
              },
              include: {
                [DB_TABLES.USER]: {
                  attributes: [],
                  required: true,
                },
              },
              extras: {
                attributes: [
                  [
                    sequelize.literal(`COUNT(DISTINCT lead_id ) `),
                    'moved_count',
                  ],
                ],
              },
            });
            nodePromises.push(movedLeadsPromise);
            // result['nodeStats'].push({
            //   name: node.name,
            //   node_id: node.node_id,
            //   // data: node.data,
            //   leadsOnCurrentNode,
            //   pausedLeads,
            //   doneAndSkippedTasksForCurrentNode,
            //   disqualifedAndConvertedLeads,
            //   movedLeads,
            // });
          } else {
            nodePromises.push(Promise.resolve([[], null]));
            // result['nodeStats'].push({
            //   name: node.name,
            //   node_id: node.node_id,
            //   // data: node.data,
            //   leadsOnCurrentNode,
            //   pausedLeads,
            //   doneAndSkippedTasksForCurrentNode,
            //   disqualifedAndConvertedLeads,
            // });
          }
          break;
        default:
          nodePromises.push(Promise.resolve([[], null]));
          // result['nodeStats'].push({
          //   name: node.name,
          //   node_id: node.node_id,
          //   // data: node.data,
          //   leadsOnCurrentNode,
          //   pausedLeads,
          //   doneAndSkippedTasksForCurrentNode,
          //   disqualifedAndConvertedLeads,
          // });
          break;
      }
    }

    const [[rawQueryResult, errForRawQueryResult], ...nodePromisesResults] =
      await Promise.all([statsRawQueryPromise, ...nodePromises]);

    if (errForRawQueryResult) {
      logger.error(
        `Error while fetching cadence stats using raw query: `,
        errForRawQueryResult
      );
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching cadence step statistics using raw query: ${errForRawQueryResult}`,
      });
    }

    let rawQueryResultMap = {};

    rawQueryResult.forEach((node) => {
      rawQueryResultMap[node.node_id] = node;
    });

    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];

      const [promiseResult, errForPromise] = nodePromisesResults[index];
      if (errForPromise) {
        logger.error(
          `Error while fetching statistics for ${node.node_id} node: `,
          errForPromise
        );
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while fetching node statistics: ${errForPromise}`,
        });
      }

      switch (node.type) {
        case NODE_TYPES.MAIL:
        case NODE_TYPES.AUTOMATED_MAIL:
        case NODE_TYPES.REPLY_TO:
        case NODE_TYPES.AUTOMATED_REPLY_TO:
          if (node.data?.aBTestEnabled) {
            result['nodeStats'].push({
              name: node.name,
              node_id: node.node_id,
              aBTestEnabled: true,
              data: promiseResult,
              leadsOnCurrentNode: [
                {
                  scheduled_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].scheduled_count ?? 0,
                      10
                    ) ?? 0,
                  current_count: parseInt(
                    rawQueryResultMap[node.node_id].current_count ?? 0,
                    10
                  ),
                },
              ],
              pausedLeads:
                parseInt(
                  rawQueryResultMap[node.node_id].paused_count ?? 0,
                  10
                ) ?? 0,
              doneAndSkippedTasksForCurrentNode: [
                {
                  completed_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].completed_count ?? 0,
                      10
                    ) ?? 0,
                  skipped_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].skipped_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
              disqualifedAndConvertedLeads: [
                {
                  status: 'trash',
                  count:
                    parseInt(
                      rawQueryResultMap[node.node_id].dq_count ?? 0,
                      10
                    ) ?? 0,
                },
                {
                  status: 'converted',
                  count:
                    parseInt(
                      rawQueryResultMap[node.node_id].converted_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
            });
          } else {
            result['nodeStats'].push({
              name: node.name,
              node_id: node.node_id,
              data: promiseResult,
              leadsOnCurrentNode: [
                {
                  scheduled_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].scheduled_count ?? 0,
                      10
                    ) ?? 0,
                  current_count: parseInt(
                    rawQueryResultMap[node.node_id].current_count ?? 0 ?? 0,
                    10
                  ),
                },
              ],
              pausedLeads:
                parseInt(
                  rawQueryResultMap[node.node_id].paused_count ?? 0,
                  10
                ) ?? 0,
              doneAndSkippedTasksForCurrentNode: [
                {
                  completed_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].completed_count ?? 0,
                      10
                    ) ?? 0,
                  skipped_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].skipped_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
              disqualifedAndConvertedLeads: [
                {
                  status: 'trash',
                  count:
                    parseInt(
                      rawQueryResultMap[node.node_id].dq_count ?? 0,
                      10
                    ) ?? 0,
                },
                {
                  status: 'converted',
                  count:
                    parseInt(
                      rawQueryResultMap[node.node_id].converted_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
            });
          }
          break;
        case NODE_TYPES.MESSAGE:
        case NODE_TYPES.AUTOMATED_MESSAGE:
          if (node.data?.aBTestEnabled) {
            result['nodeStats'].push({
              name: node.name,
              node_id: node.node_id,
              aBTestEnabled: true,
              data: promiseResult,
              leadsOnCurrentNode: [
                {
                  scheduled_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].scheduled_count ?? 0,
                      10
                    ) ?? 0,
                  current_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].current_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
              pausedLeads:
                parseInt(
                  rawQueryResultMap[node.node_id].paused_count ?? 0,
                  10
                ) ?? 0,
              doneAndSkippedTasksForCurrentNode: [
                {
                  completed_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].completed_count ?? 0,
                      10
                    ) ?? 0,
                  skipped_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].skipped_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
              disqualifedAndConvertedLeads: [
                {
                  status: 'trash',
                  count:
                    parseInt(
                      rawQueryResultMap[node.node_id].dq_count ?? 0,
                      10
                    ) ?? 0,
                },
                {
                  status: 'converted',
                  count:
                    parseInt(
                      rawQueryResultMap[node.node_id].converted_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
            });
          } else {
            result['nodeStats'].push({
              name: node.name,
              node_id: node.node_id,
              data: promiseResult,
              leadsOnCurrentNode: [
                {
                  scheduled_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].scheduled_count ?? 0,
                      10
                    ) ?? 0,
                  current_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].current_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
              pausedLeads:
                parseInt(
                  rawQueryResultMap[node.node_id].paused_count ?? 0,
                  10
                ) ?? 0,
              doneAndSkippedTasksForCurrentNode: [
                {
                  completed_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].completed_count ?? 0,
                      10
                    ) ?? 0,
                  skipped_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].skipped_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
              disqualifedAndConvertedLeads: [
                {
                  status: 'trash',
                  count:
                    parseInt(
                      rawQueryResultMap[node.node_id].dq_count ?? 0,
                      10
                    ) ?? 0,
                },
                {
                  status: 'converted',
                  count:
                    parseInt(
                      rawQueryResultMap[node.node_id].converted_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
            });
          }
          break;
        case NODE_TYPES.END:
          if (node.data?.moved_leads) {
            result['nodeStats'].push({
              name: node.name,
              node_id: node.node_id,
              // data: node.data,
              leadsOnCurrentNode: [
                {
                  scheduled_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].scheduled_count ?? 0,
                      10
                    ) ?? 0,
                  current_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].current_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
              pausedLeads:
                parseInt(
                  rawQueryResultMap[node.node_id].paused_count ?? 0,
                  10
                ) ?? 0,
              doneAndSkippedTasksForCurrentNode: [
                {
                  completed_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].completed_count ?? 0,
                      10
                    ) ?? 0,
                  skipped_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].skipped_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
              disqualifedAndConvertedLeads: [
                {
                  status: 'trash',
                  count:
                    parseInt(
                      rawQueryResultMap[node.node_id].dq_count ?? 0,
                      10
                    ) ?? 0,
                },
                {
                  status: 'converted',
                  count:
                    parseInt(
                      rawQueryResultMap[node.node_id].converted_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
              movedLeads: promiseResult,
            });
          } else {
            result['nodeStats'].push({
              name: node.name,
              node_id: node.node_id,
              // data: node.data,
              leadsOnCurrentNode: [
                {
                  scheduled_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].scheduled_count ?? 0,
                      10
                    ) ?? 0,
                  current_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].current_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
              pausedLeads:
                parseInt(
                  rawQueryResultMap[node.node_id].paused_count ?? 0,
                  10
                ) ?? 0,
              doneAndSkippedTasksForCurrentNode: [
                {
                  completed_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].completed_count ?? 0,
                      10
                    ) ?? 0,
                  skipped_count:
                    parseInt(
                      rawQueryResultMap[node.node_id].skipped_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
              disqualifedAndConvertedLeads: [
                {
                  status: 'trash',
                  count:
                    parseInt(
                      rawQueryResultMap[node.node_id].dq_count ?? 0,
                      10
                    ) ?? 0,
                },
                {
                  status: 'converted',
                  count:
                    parseInt(
                      rawQueryResultMap[node.node_id].converted_count ?? 0,
                      10
                    ) ?? 0,
                },
              ],
            });
          }
          break;
        default:
          result['nodeStats'].push({
            name: node.name,
            node_id: node.node_id,
            // data: node.data,
            leadsOnCurrentNode: [
              {
                scheduled_count:
                  parseInt(
                    rawQueryResultMap[node.node_id].scheduled_count ?? 0,
                    10
                  ) ?? 0,
                current_count:
                  parseInt(
                    rawQueryResultMap[node.node_id].current_count ?? 0,
                    10
                  ) ?? 0,
              },
            ],
            pausedLeads:
              parseInt(rawQueryResultMap[node.node_id].paused_count ?? 0, 10) ??
              0,
            doneAndSkippedTasksForCurrentNode: [
              {
                completed_count:
                  parseInt(
                    rawQueryResultMap[node.node_id].completed_count ?? 0,
                    10
                  ) ?? 0,
                skipped_count:
                  parseInt(
                    rawQueryResultMap[node.node_id].skipped_count ?? 0,
                    10
                  ) ?? 0,
              },
            ],
            disqualifedAndConvertedLeads: [
              {
                status: 'trash',

                count:
                  parseInt(rawQueryResultMap[node.node_id].dq_count ?? 0, 10) ??
                  0,
              },
              {
                status: 'converted',
                count:
                  parseInt(
                    rawQueryResultMap[node.node_id].converted_count ?? 0,
                    10
                  ) ?? 0,
              },
            ],
          });
          break;
      }
    }

    return successResponse(res, 'Fetched statistics.', result);
  } catch (err) {
    logger.error(`Error while fetching cadence statistics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence statistics: ${err.message}`,
    });
  }
};

const getCadenceStatisticsLeads = async (req, res) => {
  try {
    let {
      node_id,
      type,
      limit,
      lead_id_cursor = 0,
      searchQuery,
      cadence_id,
    } = req.body;

    if (!cadence_id) {
      let [node, errForNode] = await Repository.fetchOne({
        tableName: DB_TABLES.NODE,
        query: { node_id },
        attributes: ['cadence_id'],
      });
      if (errForNode)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch cadence statistics',
          error: `Error while fetching node: ${errForNode}`,
        });
      if (!node)
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Failed to fetch cadence statistics',
          error: `Node not found`,
        });
      cadence_id = node.cadence_id;
    }

    let result;
    const currentTimeInUnix = new Date().getTime();

    switch (type) {
      case CADENCE_STEPS_STATS_TYPE.CURRENT: {
        const [currentLeads, errForCurrentLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.TASK,
          query: {
            lead_id: {
              [Op.gt]: lead_id_cursor,
            },
            node_id: node_id,
            status: TASK_STATUSES.INCOMPLETE,
            start_time: {
              [Op.lte]: currentTimeInUnix,
            },
          },
          include: {
            [DB_TABLES.LEAD]: {
              where: searchQuery
                ? {
                    [Op.and]: [
                      {
                        status: {
                          [Op.in]: [LEAD_STATUS.ONGOING, LEAD_STATUS.NEW_LEAD],
                        },
                      },
                      sequelize.where(
                        sequelize.fn(
                          'concat',
                          sequelize.fn(
                            'lower',
                            sequelize.col('Lead.first_name')
                          ),
                          ' ',
                          sequelize.fn('lower', sequelize.col('Lead.last_name'))
                        ),
                        {
                          [Op.like]: `%${searchQuery.trim().toLowerCase()}%`,
                        }
                      ),
                    ],
                  }
                : {
                    status: {
                      [Op.in]: [LEAD_STATUS.ONGOING, LEAD_STATUS.NEW_LEAD],
                    },
                  },
              attributes: [
                'first_name',
                'last_name',
                'integration_id',
                'integration_type',
                'lead_warmth',
                'lead_score',
              ],
              required: true,
              [DB_TABLES.USER]: {
                required: true,
                attributes: ['first_name', 'last_name'],
              },
              [DB_TABLES.LEADTOCADENCE]: {
                where: {
                  status: { [Op.in]: [CADENCE_LEAD_STATUS.IN_PROGRESS] },
                  cadence_id: cadence_id,
                },
                attributes: [],
                required: true,
              },
            },
          },
          extras: {
            attributes: ['lead_id'],
            limit: limit ?? 10,
            group: ['lead_id'],
            order: ['lead_id'],
            subQuery: false,
          },
        });
        if (errForCurrentLeads)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching current leads for node: ${errForCurrentLeads}`,
            msg: 'Failed to fetch cadence statistics',
          });

        result = currentLeads;
        break;
      }
      case CADENCE_STEPS_STATS_TYPE.SCHEDULED: {
        const [scheduledLeads, errForScheduledLeads] =
          await Repository.fetchAll({
            tableName: DB_TABLES.TASK,
            query: {
              lead_id: {
                [Op.gt]: lead_id_cursor,
              },
              node_id: node_id,
              [Op.or]: [
                {
                  status: TASK_STATUSES.INCOMPLETE,
                  start_time: {
                    [Op.gt]: currentTimeInUnix,
                  },
                },
                {
                  status: TASK_STATUSES.SCHEDULED,
                },
              ],
            },
            include: {
              [DB_TABLES.LEAD]: {
                where: searchQuery
                  ? {
                      [Op.and]: [
                        {
                          status: {
                            [Op.in]: [
                              LEAD_STATUS.ONGOING,
                              LEAD_STATUS.NEW_LEAD,
                            ],
                          },
                        },
                        sequelize.where(
                          sequelize.fn(
                            'concat',
                            sequelize.fn(
                              'lower',
                              sequelize.col('Lead.first_name')
                            ),
                            ' ',
                            sequelize.fn(
                              'lower',
                              sequelize.col('Lead.last_name')
                            )
                          ),
                          {
                            [Op.like]: `%${searchQuery.trim().toLowerCase()}%`,
                          }
                        ),
                      ],
                    }
                  : {
                      status: {
                        [Op.in]: [LEAD_STATUS.ONGOING, LEAD_STATUS.NEW_LEAD],
                      },
                    },
                attributes: [
                  'first_name',
                  'last_name',
                  'integration_id',
                  'integration_type',
                ],
                required: true,
                [DB_TABLES.USER]: {
                  required: true,
                  attributes: ['first_name', 'last_name'],
                },
                [DB_TABLES.LEADTOCADENCE]: {
                  where: {
                    status: { [Op.in]: [CADENCE_LEAD_STATUS.IN_PROGRESS] },
                    cadence_id: cadence_id,
                  },
                  attributes: [],
                  required: true,
                },
              },
            },
            extras: {
              attributes: ['lead_id', 'start_time'],
              limit: limit ?? 10,
              order: ['lead_id'],
              group: ['lead_id'],
              subQuery: false,
            },
          });
        if (errForScheduledLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch cadence statistics',
            error: `Error while fetching scheduled leads for node: ${errForScheduledLeads}`,
          });

        result = scheduledLeads;
        break;
      }
      case CADENCE_STEPS_STATS_TYPE.DONE: {
        const [doneLeads, errForDoneLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.TASK,
          query: {
            cadence_id: cadence_id,
            node_id: node_id,
            status: TASK_STATUSES.COMPLETED,
            lead_id: {
              [Op.gt]: lead_id_cursor,
            },
          },
          include: {
            [DB_TABLES.LEAD]: {
              attributes: [
                'first_name',
                'last_name',
                'integration_id',
                'integration_type',
                'lead_warmth',
                'lead_score',
              ],
              required: true,
              where: searchQuery
                ? sequelize.where(
                    sequelize.fn(
                      'concat',
                      sequelize.fn('lower', sequelize.col('Lead.first_name')),
                      ' ',
                      sequelize.fn('lower', sequelize.col('Lead.last_name'))
                    ),
                    {
                      [Op.like]: `%${searchQuery.trim().toLowerCase()}%`,
                    }
                  )
                : {},
              [DB_TABLES.USER]: {
                required: true,
                attributes: ['first_name', 'last_name'],
              },
            },
          },
          extras: {
            attributes: ['lead_id'],
            limit: limit ?? 10,
            order: ['lead_id'],
            group: ['lead_id'],
            subQuery: false,
          },
        });
        if (errForDoneLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch cadence statistics',
            error: `Error while fetching done leads for node: ${errForDoneLeads}`,
          });
        result = doneLeads;
        break;
      }
      case CADENCE_STEPS_STATS_TYPE.SKIPPED: {
        const [skippedLeads, errForSkippedLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.TASK,
          query: {
            cadence_id: cadence_id,
            node_id: node_id,
            status: TASK_STATUSES.SKIPPED,
            lead_id: {
              [Op.gt]: lead_id_cursor,
            },
          },
          include: {
            [DB_TABLES.LEAD]: {
              attributes: [
                'first_name',
                'last_name',
                'integration_id',
                'integration_type',
                'lead_warmth',
                'lead_score',
              ],
              required: true,
              where: searchQuery
                ? sequelize.where(
                    sequelize.fn(
                      'concat',
                      sequelize.fn('lower', sequelize.col('Lead.first_name')),
                      ' ',
                      sequelize.fn('lower', sequelize.col('Lead.last_name'))
                    ),
                    {
                      [Op.like]: `%${searchQuery.trim().toLowerCase()}%`,
                    }
                  )
                : {},
              [DB_TABLES.USER]: {
                required: true,
                attributes: ['first_name', 'last_name'],
              },
            },
          },
          extras: {
            attributes: ['lead_id'],
            limit: limit ?? 10,

            order: ['lead_id'],
            group: ['lead_id'],
            subQuery: false,
          },
        });
        if (errForSkippedLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch cadence statistics',
            error: `Error while fetching skipped leads for node: ${errForSkippedLeads}`,
          });

        result = skippedLeads;
        break;
      }
      case CADENCE_STEPS_STATS_TYPE.CONVERTED: {
        const [convertedLeads, errForConvertedLeads] =
          await Repository.fetchAll({
            tableName: DB_TABLES.LEADTOCADENCE,
            query: {
              status_node_id: node_id,
              lead_id: {
                [Op.gt]: lead_id_cursor,
              },
            },
            include: {
              [DB_TABLES.LEAD]: {
                [DB_TABLES.USER]: {
                  attributes: ['first_name', 'last_name'],
                },
                where: searchQuery
                  ? {
                      [Op.and]: [
                        sequelize.where(
                          sequelize.fn(
                            'concat',
                            sequelize.fn(
                              'lower',
                              sequelize.col('Leads.first_name')
                            ),
                            ' ',
                            sequelize.fn(
                              'lower',
                              sequelize.col('Leads.last_name')
                            )
                          ),
                          {
                            [Op.like]: `%${searchQuery.trim().toLowerCase()}%`,
                          }
                        ),
                        { status: LEAD_STATUS.CONVERTED },
                      ],
                    }
                  : {
                      status: LEAD_STATUS.CONVERTED,
                    },
                attributes: [
                  'first_name',
                  'last_name',
                  'integration_id',
                  'integration_type',
                  'lead_warmth',
                  'lead_score',
                ],
                required: true,
              },
            },
            extras: {
              limit: limit ?? 10,
              group: ['lead_id'],
              order: ['lead_id'],
              attributes: ['lead_id'],
              subQuery: false,
            },
          });
        if (errForConvertedLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch cadence statistics',
            error: `Error while fetching converted leads for node: ${errForConvertedLeads}`,
          });

        result = convertedLeads;
        break;
      }
      case CADENCE_STEPS_STATS_TYPE.DISQUALIFIED: {
        const [disqualifiedLeads, errForDisqualifiedLeads] =
          await Repository.fetchAll({
            tableName: DB_TABLES.LEADTOCADENCE,
            query: {
              status_node_id: node_id,
              lead_id: {
                [Op.gt]: lead_id_cursor,
              },
            },
            include: {
              [DB_TABLES.LEAD]: {
                [DB_TABLES.USER]: {
                  attributes: ['first_name', 'last_name'],
                },
                where: searchQuery
                  ? {
                      [Op.and]: [
                        sequelize.where(
                          sequelize.fn(
                            'concat',
                            sequelize.fn(
                              'lower',
                              sequelize.col('Leads.first_name')
                            ),
                            ' ',
                            sequelize.fn(
                              'lower',
                              sequelize.col('Leads.last_name')
                            )
                          ),
                          {
                            [Op.like]: `%${searchQuery.trim().toLowerCase()}%`,
                          }
                        ),
                        { status: LEAD_STATUS.TRASH },
                      ],
                    }
                  : {
                      status: LEAD_STATUS.TRASH,
                    },
                attributes: [
                  'first_name',
                  'last_name',
                  'integration_id',
                  'integration_type',
                  'lead_warmth',
                  'lead_score',
                ],
                required: true,
              },
            },
            extras: {
              limit: limit ?? 10,
              group: ['lead_id'],
              order: ['lead_id'],
              attributes: ['lead_id'],
              subQuery: false,
            },
          });
        if (errForDisqualifiedLeads)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching disqualified leads for node: ${errForDisqualifiedLeads}`,
            msg: 'Failed to fetch cadence statistics',
          });

        result = disqualifiedLeads;
        break;
      }
      case CADENCE_STEPS_STATS_TYPE.PAUSED: {
        const [pausedLeads, errForPausedLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.TASK,
          query: {
            node_id: node_id,
            status: [TASK_STATUSES.INCOMPLETE, TASK_STATUSES.SCHEDULED],
            lead_id: {
              [Op.gt]: lead_id_cursor,
            },
          },

          include: {
            [DB_TABLES.LEAD]: {
              where: searchQuery
                ? {
                    [Op.and]: [
                      sequelize.where(
                        sequelize.fn(
                          'concat',
                          sequelize.fn(
                            'lower',
                            sequelize.col('Lead.first_name')
                          ),
                          ' ',
                          sequelize.fn('lower', sequelize.col('Lead.last_name'))
                        ),
                        {
                          [Op.like]: `%${searchQuery.trim().toLowerCase()}%`,
                        }
                      ),
                    ],
                  }
                : {},
              attributes: [
                'first_name',
                'last_name',
                'integration_id',
                'integration_type',
                'lead_warmth',
                'lead_score',
              ],
              required: true,
              [DB_TABLES.USER]: {
                required: true,
                attributes: ['first_name', 'last_name'],
              },
              [DB_TABLES.LEADTOCADENCE]: {
                where: {
                  status: CADENCE_LEAD_STATUS.PAUSED,
                  cadence_id: cadence_id,
                },
                attributes: [],
                required: true,
              },
            },
          },
          extras: {
            attributes: ['lead_id'],
            limit: limit ?? 10,
            order: ['lead_id'],
            group: ['lead_id'],
            subQuery: false,
          },
        });
        if (errForPausedLeads)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching paused leads for node: ${errForPausedLeads}`,
            msg: 'Failed to fetch cadence statistics',
          });

        result = pausedLeads;
        break;
      }
      default: {
        return badRequestResponseWithDevMsg({
          res,
          msg: `Provide a vaild type for cadence statistics`,
        });
      }
    }

    return successResponse(res, 'Fetched statistics.', result);
  } catch (err) {
    logger.error(`Error while fetching cadence statistics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence statistics: ${err.message}`,
    });
  }
};

const getCadenceMailStatisticsLeads = async (req, res) => {
  try {
    const {
      node_id,
      type,
      ab_template_id,
      abTestEnabled,
      limit,
      offset,
      searchQuery,
    } = req.body;

    let result;
    let emailQuery;

    switch (type) {
      case EMAIL_STATUS.OPENED: {
        emailQuery = {
          node_id: node_id,
          status: [EMAIL_STATUS.OPENED, EMAIL_STATUS.CLICKED],
        };
        break;
      }
      case EMAIL_STATUS.CLICKED: {
        emailQuery = {
          node_id,
          status: EMAIL_STATUS.CLICKED,
        };
        break;
      }
      case EMAIL_STATUS.BOUNCED: {
        emailQuery = {
          node_id,
          status: EMAIL_STATUS.BOUNCED,
        };
        break;
      }
      case EMAIL_STATUS.UNSUBSCRIBED: {
        emailQuery = {
          node_id: node_id,
          unsubscribed: 1,
        };
        break;
      }
      case 'replied':
        {
          emailQuery = {
            node_id: node_id,
            sent: 0,
            status: [EMAIL_STATUS.DELIVERED, EMAIL_STATUS.OPENED],
          };
        }
        break;
    }

    if (abTestEnabled) {
      const [templateMails, errForTemplateMails] = await Repository.fetchAll({
        tableName: DB_TABLES.A_B_TESTING,
        query: {
          node_id: node_id,
          ab_template_id: ab_template_id,
        },
        include: {
          [DB_TABLES.EMAIL]: {
            required: true,
            where: emailQuery,
            attributes: ['lead_id'],
            [DB_TABLES.LEAD]: {
              required: true,
              where: searchQuery
                ? sequelize.where(
                    sequelize.fn(
                      'concat',
                      sequelize.fn(
                        'lower',
                        sequelize.col('Email.Lead.first_name')
                      ),
                      ' ',
                      sequelize.fn(
                        'lower',
                        sequelize.col('Email.Lead.last_name')
                      )
                    ),
                    {
                      [Op.like]: `%${searchQuery.trim().toLowerCase()}%`,
                    }
                  )
                : {},
              attributes: [
                'first_name',
                'last_name',
                'integration_id',
                'integration_type',
              ],
              [DB_TABLES.USER]: {
                required: true,
                attributes: ['first_name', 'last_name'],
              },
            },
          },
        },
        extras: {
          group: ['Email.lead_id'],
          limit: limit ?? 10,
          offset: offset ?? 0,
          attributes: ['message_id'],
          order: [['Email', 'lead_id', 'ASC']],
          subQuery: false,
        },
      });
      if (errForTemplateMails) {
        logger.error(
          `Error while fetching ab template stats: `,
          errForTemplateMails
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch cadence mail statistics lead',
          error: `Error while fetching ab template mails for statistics : ${errForTemplateMails}`,
        });
      }
      result = templateMails;
    } else {
      const [leads, errForLeads] = await Repository.fetchAll({
        tableName: DB_TABLES.EMAIL,
        query: emailQuery,
        include: {
          [DB_TABLES.LEAD]: {
            required: true,
            attributes: [
              'first_name',
              'last_name',
              'integration_type',
              'integration_id',
            ],
            where: searchQuery
              ? sequelize.where(
                  sequelize.fn(
                    'concat',
                    sequelize.fn('lower', sequelize.col('Lead.first_name')),
                    ' ',
                    sequelize.fn('lower', sequelize.col('Lead.last_name'))
                  ),
                  {
                    [Op.like]: `%${searchQuery.trim().toLowerCase()}%`,
                  }
                )
              : {},
          },
          [DB_TABLES.USER]: {
            required: true,
            attributes: ['first_name', 'last_name'],
          },
        },
        extras: {
          attributes: ['lead_id'],
          order: [['lead_id', 'ASC']],
          group: [sequelize.col('Email.lead_id')],
          limit: limit ?? 10,
          offset: offset ?? 0,
          subQuery: false,
        },
      });
      if (errForLeads) {
        logger.error(`Error while fetching leads for emails: `, errForLeads);
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch cadence mail statistics lead',
          error: `Error while fetching leads for emails: ${errForLeads}`,
        });
      }
      result = leads;
    }

    return successResponse(res, 'Fetched mail statistics.', result);
  } catch (err) {
    logger.error(`Error while fetching cadence mail statistics leads: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence mail statistics leads: ${err.message}`,
    });
  }
};

const getCadenceMessageStatisticsLeads = async (req, res) => {
  try {
    const {
      node_id,
      type,
      ab_template_id,
      abTestEnabled,
      limit,
      offset,
      searchQuery,
    } = req.body;

    let result;
    let messageQuery;

    switch (type) {
      case SMS_STATUS.CLICKED: {
        messageQuery = {
          node_id,
          status: SMS_STATUS.CLICKED,
        };
        break;
      }
    }

    if (abTestEnabled) {
      const [templateMessages, errForTemplateMessages] =
        await Repository.fetchAll({
          tableName: DB_TABLES.A_B_TESTING,
          query: {
            node_id: node_id,
            ab_template_id: ab_template_id,
          },
          include: {
            [DB_TABLES.MESSAGE]: {
              required: true,
              where: messageQuery,
              attributes: ['lead_id'],
              [DB_TABLES.LEAD]: {
                required: true,
                where: searchQuery
                  ? sequelize.where(
                      sequelize.fn(
                        'concat',
                        sequelize.fn(
                          'lower',
                          sequelize.col('Message.Lead.first_name')
                        ),
                        ' ',
                        sequelize.fn(
                          'lower',
                          sequelize.col('Message.Lead.last_name')
                        )
                      ),
                      {
                        [Op.like]: `%${searchQuery.trim().toLowerCase()}%`,
                      }
                    )
                  : {},
                attributes: [
                  'first_name',
                  'last_name',
                  'integration_id',
                  'integration_type',
                ],
                [DB_TABLES.USER]: {
                  required: true,
                  attributes: ['first_name', 'last_name'],
                },
              },
            },
          },
          extras: {
            group: ['Message.lead_id'],
            limit: limit ?? 10,
            offset: offset ?? 0,
            attributes: ['sms_id'],
            order: [['Message', 'lead_id', 'ASC']],
          },
        });
      if (errForTemplateMessages) {
        logger.error(
          `Error while fetching ab template stats: `,
          errForTemplateMessages
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch cadence message statistics leads',
          error: `Error while fetching ab template message for statistics : ${errForTemplateMessages}`,
        });
      }
      result = templateMessages;
    } else {
      const [leads, errForLeads] = await Repository.fetchAll({
        tableName: DB_TABLES.MESSAGE,
        query: messageQuery,
        include: {
          [DB_TABLES.LEAD]: {
            required: true,
            attributes: [
              'first_name',
              'last_name',
              'integration_type',
              'integration_id',
            ],
            where: searchQuery
              ? sequelize.where(
                  sequelize.fn(
                    'concat',
                    sequelize.fn('lower', sequelize.col('Lead.first_name')),
                    ' ',
                    sequelize.fn('lower', sequelize.col('Lead.last_name'))
                  ),
                  {
                    [Op.like]: `%${searchQuery.trim().toLowerCase()}%`,
                  }
                )
              : {},
          },
          [DB_TABLES.USER]: {
            required: true,
            attributes: ['first_name', 'last_name'],
          },
        },
        extras: {
          attributes: ['lead_id'],
          order: [['lead_id', 'ASC']],
          group: [sequelize.col('Message.lead_id')],
          limit: limit ?? 10,
          offset: offset ?? 0,
        },
      });
      if (errForLeads) {
        logger.error(`Error while fetching leads for messages: `, errForLeads);
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch cadence message statistics leads',
          error: `Error while fetching messages: ${errForLeads}`,
        });
      }
      result = leads;
    }

    return successResponse(res, 'Fetched message statistics.', result);
  } catch (err) {
    logger.error(
      `Error while fetching cadence message statistics leads: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence message statistics leads: ${err.message}`,
    });
  }
};

const reassignLeadsAndContacts = async (req, res) => {
  //let t = await sequelize.transaction();
  try {
    const validation = cadenceSchema.reassignLeadsAndContactsSchema.validate(
      req.body
    );
    if (validation.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: validation.error.message,
      });

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id: req.body.cadence_id },
      include: {
        [DB_TABLES.USER]: {
          attributes: ['company_id', 'sd_id'],
        },
      },
    });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to reassign leads and contacts in cadence',
        error: `Error while fetching cadence: ${errForCadence}`,
      });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to reassign leads and contacts in cadence',
        error: `No cadence found`,
      });

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: ['integration_type'],
        },
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to reassign leads and contacts in cadence',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to reassign leads and contacts in cadence',
        error: `No user found`,
      });

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence,
      user,
      action: CADENCE_ACTIONS.REASSIGN,
    });
    if (errForAccess)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to reassign leads and contacts in cadence',
        error: `Error while checking cadence action access: ${errForAccess}`,
      });
    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });

    let access_token = '',
      instance_url = '',
      errForAccessToken = '';

    switch (user.Company?.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        // Get access token and instance url
        [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });
        if (
          [
            'Kindly sign in with your crm.',
            'Kindly log in with salesforce.',
            'Error while getting access token and refresh token from salesforce auth',
          ].includes(errForAccessToken)
        ) {
          // t.rollback();
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Kindly log in to salesforce to create a cadence',
          });
        }
        break;

      case CRM_INTEGRATIONS.PIPEDRIVE:
        break;

      case CRM_INTEGRATIONS.SHEETS:
        break;

      case CRM_INTEGRATIONS.SELLSY:
        // Get access token
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
        if (errCrmAdmin) return serverErrorResponse(res, errCrmAdmin);

        let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
        if (!crmAdminUserId)
          return notFoundResponseWithDevMsg({
            res,
            msg: 'Failed to reassign leads and contacts in cadence',
            error: 'Unable to find CRM Admin',
          });

        [{ access_token }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SELLSY,
            user_id: crmAdminUserId,
          });
        if (errForAccessToken)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Please connect with sellsy to reassign contact or account',
          });

        break;

      case CRM_INTEGRATIONS.DYNAMICS:
        // Get access token and instance url
        [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.DYNAMICS,
            user_id: req.user.user_id,
          });
        if (errForAccessToken) {
          if (errForAccessToken === 'Kindly log in to dynamics.')
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Kindly log in to dynamics to reassign leads',
            });

          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to reassign leads and contacts in cadence',
            error: `Error while getting access token and refresh token from dynamics auth: ${errForAccessToken}`,
          });
        }
        break;
      default:
        break;
    }

    const leadIds = req.body.leadIds;
    const contactIds = req.body.contactIds;
    let leads = [];
    let contacts = [];
    let errForLeads, errForContacts;
    let leadOrder = [];
    let contactOrder = [];

    if (leadIds?.length)
      leadOrder.push(sequelize.literal(`FIELD(lead_id, ${leadIds.join(',')})`));

    if (contactIds?.length)
      contactOrder.push(
        sequelize.literal(`FIELD(lead_id, ${contactIds.join(',')})`)
      );

    switch (user.Company?.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        [leads, errForLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            lead_id: {
              [Op.in]: leadIds,
            },
          },
          include: {
            [DB_TABLES.ACCOUNT]: {
              attributes: ['account_id'],
            },
          },
          extras: {
            order: leadOrder,
          },
        });
        if (errForLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to reassign leads and contacts in cadence',
            error: `Error while fetching leads: ${errForLeads}.`,
          });

        [contacts, errForContacts] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            lead_id: {
              [Op.in]: contactIds,
            },
            salesforce_contact_id: {
              [Op.ne]: null,
            },
          },
          include: {
            [DB_TABLES.ACCOUNT]: {
              attributes: ['account_id', 'salesforce_account_id'],
            },
          },
          extras: {
            order: contactOrder,
          },
        });
        if (errForContacts)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to reassign leads and contacts in cadence',
            error: `Error while fetching contacts: ${errForContacts}.`,
          });

        break;
      case CRM_INTEGRATIONS.SELLSY:
        [contacts, errForContacts] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            lead_id: {
              [Op.in]: contactIds,
            },
            integration_type: LEAD_INTEGRATION_TYPES.SELLSY_CONTACT,
          },
          include: {
            [DB_TABLES.ACCOUNT]: {
              attributes: ['account_id', 'integration_id'],
            },
          },
          extras: {
            order: contactOrder,
          },
        });
        if (errForContacts)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to reassign leads and contacts in cadence',
            error: `Error while fetching sellsy contacts: ${errForContacts}.`,
          });

        break;

      case CRM_INTEGRATIONS.DYNAMICS:
        const leadPromise = Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            lead_id: {
              [Op.in]: leadIds,
            },
            company_id: req.user.company_id,
          },
          include: {
            [DB_TABLES.ACCOUNT]: {
              attributes: ['account_id'],
            },
          },
          extras: {
            attributes: ['integration_id'],
            order: leadOrder,
          },
        });

        const contactPromise = Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            lead_id: {
              [Op.in]: contactIds,
            },
            company_id: req.user.company_id,
          },
          include: {
            [DB_TABLES.ACCOUNT]: {
              attributes: ['account_id', 'integration_id'],
            },
          },
          extras: {
            attributes: ['integration_id'],
            order: contactOrder,
          },
        });

        [[leads, errForLeads], [contacts, errForContacts]] = await Promise.all([
          leadPromise,
          contactPromise,
        ]);
        if (errForLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to reassign leads and contacts in cadence',
            error: `Error while fetching leads: ${errForLeads}.`,
          });

        if (errForContacts)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to reassign leads and contacts in cadence',
            error: `Error while fetching contacts: ${errForContacts}.`,
          });

        break;

      default:
        return badRequestResponseWithDevMsg({
          res,
          msg: `Reassignment not supported for ${user.Company?.integration_type}`,
        });
    }

    successResponse(res, `Reassignment started, Will be done soon.`);

    const [data, err] = await LeadHelper.reassignLeads({
      ...req.body,
      leads,
      contacts,
      access_token,
      instance_url,
      integration_type: user.Company?.integration_type,
    });

    //return successResponse(res, `Reassignment completed.`);
  } catch (err) {
    logger.error(
      `Error while reassigning leads and contacts in cadence: `,
      err
    );
    // return serverErrorResponse(
    //   res,
    //   `Error while reassigning leads and contacts in cadence: ${err.message}.`
    // );
  }
};

const getTestMailUsers = async (req, res) => {
  try {
    const body = cadenceSchema.fetchTestMailUsersSchema.validate(req.query);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // decide the token field attribute for token to be fetched based upon mail_integration_type
    let isTokenExpiredFieldName;
    switch (req.user.mail_integration_type) {
      case MAIL_INTEGRATION_TYPES.GOOGLE:
        isTokenExpiredFieldName = 'is_google_token_expired';
        break;
      case MAIL_INTEGRATION_TYPES.OUTLOOK:
        isTokenExpiredFieldName = 'is_outlook_token_expired';
        break;
    }

    if (body.value.from === 'cadence') {
      const [cadence, errForCadence] = await Repository.fetchOne({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id: body.value.cadence_id },
        include: {
          [DB_TABLES.USER]: {
            attributes: ['company_id'],
          },
        },
      });
      if (errForCadence)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch test mail users',
          error: `Error while fetching cadence: ${errForCadence}`,
        });
      if (!cadence)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to fetch test mail users',
          error: 'Cadence not found',
        });

      switch (req.user.role) {
        case USER_ROLE.SALES_PERSON: {
          return badRequestResponseWithDevMsg({
            res,
            msg: 'You do not have access',
          });
        }
        case USER_ROLE.SALES_MANAGER: {
          // If sales manager person cadence opened, is it the email of the sales manager by default?
          const [users, errForUsers] = await Repository.fetchAll({
            tableName: DB_TABLES.USER,
            query: { sd_id: req.user.sd_id },
            include: {
              [DB_TABLES.USER_TOKEN]: {
                attributes: [isTokenExpiredFieldName],
              },
            },
            extras: {
              attributes: ['user_id', 'first_name', 'last_name'],
            },
          });
          if (errForUsers)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch test mail users',
              error: `Error while fetching users: ${errForUsers}`,
            });
          return successResponse(res, 'Users fetching successfully.', users);
        }
        case USER_ROLE.SUPER_ADMIN:
        case USER_ROLE.ADMIN: {
          const [users, errForUsers] = await Repository.fetchAll({
            tableName: DB_TABLES.USER,
            query: { company_id: cadence?.User?.company_id },
            include: {
              [DB_TABLES.USER_TOKEN]: {
                attributes: [isTokenExpiredFieldName],
              },
            },
            extras: {
              attributes: ['user_id', 'first_name', 'last_name'],
            },
          });
          if (errForUsers)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch test mail users',
              error: `Error while fetching users: ${errForUsers}`,
            });
          return successResponse(res, 'Users fetching successfully.', users);
        }
      }
    } else {
      switch (req.user.role) {
        case USER_ROLE.SALES_PERSON: {
          return badRequestResponseWithDevMsg({
            res,
            msg: 'You cannot send mail from other users',
          });
        }
        case USER_ROLE.SALES_MANAGER: {
          const [users, errForUsers] = await Repository.fetchAll({
            tableName: DB_TABLES.USER,
            query: { sd_id: req.user.sd_id },
            include: {
              [DB_TABLES.USER_TOKEN]: {
                attributes: [isTokenExpiredFieldName],
              },
            },
            extras: {
              attributes: ['user_id', 'first_name', 'last_name'],
            },
          });
          if (errForUsers)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch test mail users',
              error: `Error while fetching users: ${errForUsers}`,
            });
          return successResponse(res, 'Users fetching successfully.', users);
        }
        case USER_ROLE.SUPER_ADMIN:
        case USER_ROLE.ADMIN: {
          const [admin, errForAdmin] = await Repository.fetchOne({
            tableName: DB_TABLES.USER,
            query: { user_id: req.user.user_id },
            extras: { attributes: ['company_id'] },
          });
          if (errForAdmin)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch test mail users',
              error: `Error while fetching admin: ${errForAdmin}`,
            });

          const [users, errForUsers] = await Repository.fetchAll({
            tableName: DB_TABLES.USER,
            query: { company_id: admin.company_id },
            include: {
              [DB_TABLES.USER_TOKEN]: {
                attributes: [isTokenExpiredFieldName],
              },
            },
            extras: {
              attributes: ['user_id', 'first_name', 'last_name'],
            },
          });
          if (errForUsers)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch test mail users',
              error: `Error while fetching users: ${errForUsers}`,
            });
          return successResponse(res, 'Users fetching successfully.', users);
        }
      }
    }

    return badRequestResponseWithDevMsg({
      res,
      msg: 'No users fetched. Please try again later or contact support',
    });
  } catch (err) {
    logger.error(`Error while fetching test mail users: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching test mail users: ${err.message}.`,
    });
  }
};

// * Get allowed statuses for account and contact
const getAllowedStatuses = async (req, res) => {
  try {
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE: {
        let [salesforceFieldMap, errorFetchingSalesforceFieldMap] =
          await SalesforceHelper.getFieldMapForCompanyFromUser(
            req.user.user_id
          );
        if (errorFetchingSalesforceFieldMap)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch allowed statuses',
            error: `Error while fetching fieldmap for company from user: ${errorFetchingSalesforceFieldMap}`,
          });

        let { account_map, lead_map, contact_map } = salesforceFieldMap;

        let account_integration_status = account_map.integration_status;
        let account_disqualification_reasons =
          account_map.disqualification_reason;
        let lead_integration_status = lead_map.integration_status;
        let lead_disqualification_reasons = lead_map.disqualification_reason;
        let contact_integration_status = contact_map.integration_status;
        let contact_disqualification_reasons =
          contact_map.disqualification_reason;

        return successResponse(res, 'Successfully fetched allowed statuses', {
          account_integration_status,
          account_disqualification_reasons,
          lead_integration_status,
          lead_disqualification_reasons,
          contact_integration_status,
          contact_disqualification_reasons,
        });
      }
      case CRM_INTEGRATIONS.HUBSPOT: {
        let [hubspotFieldMap, errFetchingHubspotFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingHubspotFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch allowed statuses',
            error: `Error while fetching Hubspot fieldmap: ${errFetchingHubspotFieldMap}`,
          });

        let contact_map = hubspotFieldMap.contact_map;
        let contact_integration_status = contact_map.integration_status;
        let contact_disqualification_reasons =
          contact_map.disqualification_reason;
        return successResponse(res, 'Successfully fetched allowed statuses', {
          contact_integration_status,
          contact_disqualification_reasons,
        });
      }
      case HIRING_INTEGRATIONS.BULLHORN: {
        let [bullhornFieldMap, errFetchingBullhornFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingBullhornFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch allowed statuses',
            error: `Error while fetching Bullhorn fieldmap: ${errFetchingBullhornFieldMap}`,
          });
        let { account_map, lead_map, contact_map, candidate_map } =
          bullhornFieldMap;

        let account_integration_status = account_map.integration_status;
        let account_disqualification_reasons =
          account_map.disqualification_reason;
        let lead_integration_status = lead_map.integration_status;
        let lead_disqualification_reasons = lead_map.disqualification_reason;
        let contact_integration_status = contact_map.integration_status;
        let contact_disqualification_reasons =
          contact_map.disqualification_reason;
        let candidate_integration_status = candidate_map.integration_status;
        let candidate_disqualification_reasons =
          candidate_map.disqualification_reason;
        return successResponse(res, 'Successfully fetched allowed statuses', {
          account_integration_status,
          account_disqualification_reasons,
          lead_integration_status,
          lead_disqualification_reasons,
          contact_integration_status,
          contact_disqualification_reasons,
          candidate_integration_status,
          candidate_disqualification_reasons,
        });
      }
      default:
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Invalid integration type',
        });
    }
  } catch (err) {
    logger.error(
      `An error occurred while fetching allowed statuses for lead and accounts: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching allowed statuses for lead and accounts: ${err.message}`,
    });
  }
};

const bulkPauseCadenceForLead = async (req, res) => {
  try {
    let { lead_ids, cadence_id, pauseFor, option } = req.body;

    if (!Object.values(BULK_OPTIONS).includes(option))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to pause leads',
        error: `Invalid option selected`,
      });

    // Get cadence info
    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
      },
      extras: {
        attributes: [
          'cadence_id',
          'name',
          'status',
          'type',
          'user_id',
          'sd_id',
          'company_id',
        ],
      },
    });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'This cadence does not exist',
      });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to pause leads',
        error: `Error while fetching cadence: ${errForCadence}`,
      });

    if (option === BULK_OPTIONS.ALL) {
      let query = {
        cadence_id,
      };
      query.status = {
        [Op.in]: [CADENCE_LEAD_STATUS.IN_PROGRESS],
      };
      let lead_query = {};
      let leadAndQuery = [];

      if (req.body.user_id) leadAndQuery.push({ user_id: req.body.user_id });
      if (req.body.search)
        leadAndQuery.push(
          sequelize.where(
            sequelize.fn(
              'concat',
              sequelize.fn('lower', sequelize.col('first_name')),
              ' ',
              sequelize.fn('lower', sequelize.col('last_name'))
            ),
            {
              [Op.like]: `%${req.body.search.trim().toLowerCase()}%`,
            }
          )
        );

      if (Object.keys(lead_query)?.length)
        lead_query = {
          [Op.and]: leadAndQuery,
        };

      let extras = {
        order: [['created_at', 'DESC']],
        attributes: [
          'lead_id',
          'first_name',
          'last_name',
          'status',
          'job_position',
          'salesforce_lead_id',
          'salesforce_contact_id',
          'integration_id',
          'integration_type',
          'user_id',
          'created_at',
        ],
        required: true,
      };

      // * get leads for the cadence
      let [cadenceLeads, errForCadenceLeads] = await Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: lead_query,
        include: {
          [DB_TABLES.LEADTOCADENCE]: {
            where: query,
            attributes: ['status', 'created_at', 'unix_resume_at'],
            required: true,
          },
          [DB_TABLES.ACCOUNT]: {
            attributes: ['name'],
          },
          [DB_TABLES.LEAD_PHONE_NUMBER]: {
            attributes: ['phone_number', 'type', 'is_primary'],
          },
          [DB_TABLES.LEAD_EMAIL]: {
            attributes: ['email_id', 'type', 'is_primary'],
          },
          [DB_TABLES.USER]: {
            attributes: ['first_name', 'last_name'],
            //[tokens]: {},
          },
        },
        extras,
      });

      if (errForCadenceLeads)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to pause leads',
          error: `Error while fetching leads: ${errForCadenceLeads}`,
        });
      lead_ids = cadenceLeads;
    }

    logger.info(`Total lead ids to pause: ` + lead_ids?.length);
    //return successResponse(res, `wip`);
    successResponse(
      res,
      'Processing has been started, please check after some time.'
    );
    for (let lead_id of lead_ids) {
      if (option === BULK_OPTIONS.ALL) lead_id = lead_id?.lead_id;
      const [data, err] = await CadenceHelper.pauseCadenceForLead(
        lead_id,
        [cadence_id],
        pauseFor,
        req.user
      );
      if (err) logger.error('Error while pausing leads: ', err);

      AutomatedTasksHelper.deleteAutomatedTasks({
        lead_id,
        cadence_id,
      });

      await WorkflowHelper.applyWorkflow({
        trigger: WORKFLOW_TRIGGERS.WHEN_A_CADENCE_IS_PAUSED,
        cadence_id,
        lead_id,
      });
    }
    // recalculate tasks for this user
    TaskHelper.recalculateDailyTasksForUsers([req.user.user_id]);
  } catch (err) {
    logger.error(`Error while bulk pausing leads: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while bulk pausing leads:${err.message}`,
    });
  }
};

const bulkStopCadenceForLead = async (req, res) => {
  try {
    let { lead_ids, cadence_id, option } = req.body;

    if (!Object.values(BULK_OPTIONS).includes(option))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to stop leads',
        error: `Invalid option selected`,
      });

    // Get cadence info
    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
      },
      extras: {
        attributes: [
          'cadence_id',
          'name',
          'status',
          'type',
          'user_id',
          'sd_id',
          'company_id',
        ],
      },
    });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to stop leads',
        error: 'This cadence does not exist',
      });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to stop leads',
        error: `Error while fetching cadence: ${errForCadence}`,
      });

    if (option === BULK_OPTIONS.ALL) {
      let query = {
        cadence_id,
      };
      let lead_query = {};
      let leadAndQuery = [];
      query.status = {
        [Op.in]: [CADENCE_LEAD_STATUS.PAUSED, CADENCE_LEAD_STATUS.IN_PROGRESS],
      };

      //if (req.body.user_id) lead_query.user_id = req.body.user_id;
      if (req.body.user_id) leadAndQuery.push({ user_id: req.body.user_id });
      if (req.body.search)
        leadAndQuery.push(
          sequelize.where(
            sequelize.fn(
              'concat',
              sequelize.fn('lower', sequelize.col('first_name')),
              ' ',
              sequelize.fn('lower', sequelize.col('last_name'))
            ),
            {
              [Op.like]: `%${req.body.search.trim().toLowerCase()}%`,
            }
          )
        );

      if (Object.keys(lead_query)?.length)
        lead_query = {
          [Op.and]: leadAndQuery,
        };

      let extras = {
        order: [['created_at', 'DESC']],
        attributes: [
          'lead_id',
          'first_name',
          'last_name',
          'status',
          'job_position',
          'salesforce_lead_id',
          'salesforce_contact_id',
          'integration_id',
          'integration_type',
          'user_id',
          'created_at',
        ],
        required: true,
      };

      // * get leads for the cadence
      let [cadenceLeads, errForCadenceLeads] = await Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: lead_query,
        include: {
          [DB_TABLES.LEADTOCADENCE]: {
            where: query,
            attributes: ['status', 'created_at', 'unix_resume_at'],
            required: true,
          },
          [DB_TABLES.ACCOUNT]: {
            attributes: ['name'],
          },
          [DB_TABLES.LEAD_PHONE_NUMBER]: {
            attributes: ['phone_number', 'type', 'is_primary'],
          },
          [DB_TABLES.LEAD_EMAIL]: {
            attributes: ['email_id', 'type', 'is_primary'],
          },
          [DB_TABLES.USER]: {
            attributes: ['first_name', 'last_name'],
            //[tokens]: {},
          },
        },
        extras,
      });

      if (errForCadenceLeads)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to stop leads',
          error: `Error while fetching leads: ${errForCadenceLeads}`,
        });
      lead_ids = cadenceLeads;
    }

    logger.info(`Total lead ids to pause: ` + lead_ids?.length);
    //return successResponse(res, `wip`);
    successResponse(
      res,
      'Processing has been started, please check after some time.'
    );

    for (let lead_id of lead_ids) {
      if (option === BULK_OPTIONS.ALL) lead_id = lead_id?.lead_id;
      const [data, err] = await CadenceHelper.stopCadenceForLead(
        lead_id,
        '',
        '',
        [cadence_id],
        req.user
      );
      if (err) {
        if (
          [
            `Cannot stop cadence for a lead. It's already stopped.`,
            'Lead not found',
            'Invalid status sent.',
          ].includes(err)
        )
          logger.error('Error while stoping leads: ', err);
        logger.error('Error while stoping leads: ', err);
      }

      //logger.info(`Lead ${lead_id} updated with status ${status}.`);

      // Delete automatedTasks belonging to this cadence
      AutomatedTasksHelper.deleteAutomatedTasks({
        lead_id,
        cadence_id,
      });
    }
    // recalculate tasks for this user
    TaskHelper.recalculateDailyTasksForUsers([req.user.user_id]);

    lead_ids.forEach((lead_id) =>
      WorkflowHelper.applyWorkflow({
        trigger: WORKFLOW_TRIGGERS.WHEN_A_CADENCE_IS_MANUALLY_STOPPED,
        cadence_id,
        lead_id,
      })
    );
  } catch (err) {
    logger.error(`Error while bulk stopping leads: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while bulk stopping leads: ${err.message}`,
    });
  }
};

const bulkResumeCadenceForLead = async (req, res) => {
  try {
    let { lead_ids, cadence_id, option } = req.body;

    if (!Object.values(BULK_OPTIONS).includes(option))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to resume leads',
        error: `Invalid option selected`,
      });

    // Get cadence info
    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
      },
      extras: {
        attributes: [
          'cadence_id',
          'name',
          'status',
          'type',
          'user_id',
          'sd_id',
          'company_id',
        ],
      },
    });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to resume leads',
        error: 'This cadence does not exist',
      });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to resume leads',
        error: `Error while fetching cadence: ${errForCadence}`,
      });

    if (option === BULK_OPTIONS.ALL) {
      let query = {
        cadence_id,
      };
      query.status = {
        [Op.in]: [CADENCE_LEAD_STATUS.PAUSED],
      };
      let lead_query = {};
      let leadAndQuery = [];

      if (req.body.user_id) leadAndQuery.push({ user_id: req.body.user_id });
      if (req.body.search)
        leadAndQuery.push(
          sequelize.where(
            sequelize.fn(
              'concat',
              sequelize.fn('lower', sequelize.col('first_name')),
              ' ',
              sequelize.fn('lower', sequelize.col('last_name'))
            ),
            {
              [Op.like]: `%${req.body.search.trim().toLowerCase()}%`,
            }
          )
        );

      if (Object.keys(lead_query)?.length)
        lead_query = {
          [Op.and]: leadAndQuery,
        };

      let extras = {
        order: [['created_at', 'DESC']],
        attributes: [
          'lead_id',
          'first_name',
          'last_name',
          'status',
          'job_position',
          'salesforce_lead_id',
          'salesforce_contact_id',
          'integration_id',
          'integration_type',
          'user_id',
          'created_at',
        ],
        required: true,
      };

      // * get leads for the cadence
      let [cadenceLeads, errForCadenceLeads] = await Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: lead_query,
        include: {
          [DB_TABLES.LEADTOCADENCE]: {
            where: query,
            attributes: ['status', 'created_at', 'unix_resume_at'],
            required: true,
          },
          [DB_TABLES.ACCOUNT]: {
            attributes: ['name'],
          },
          [DB_TABLES.LEAD_PHONE_NUMBER]: {
            attributes: ['phone_number', 'type', 'is_primary'],
          },
          [DB_TABLES.LEAD_EMAIL]: {
            attributes: ['email_id', 'type', 'is_primary'],
          },
          [DB_TABLES.USER]: {
            attributes: ['first_name', 'last_name'],
            //[tokens]: {},
          },
        },
        extras,
      });

      if (errForCadenceLeads)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to resume leads',
          error: `Error while fetching leads: ${errForCadenceLeads}`,
        });
      lead_ids = cadenceLeads;
    }

    logger.info(`Total lead ids to resume: ` + lead_ids?.length);

    successResponse(
      res,
      'Processing has been started, please check after some time.'
    );
    for (let lead_id of lead_ids) {
      if (option === BULK_OPTIONS.ALL) lead_id = lead_id?.lead_id;
      const [data, err] = await CadenceHelper.resumeCadenceForLead(lead_id, [
        cadence_id,
      ]);
      if (err) logger.error('Error while resuming leads: ', err);
    }
    // recalculate tasks for this user
    TaskHelper.recalculateDailyTasksForUsers([req.user.user_id]);
  } catch (err) {
    logger.error(`Error while bulk resuming leads: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while bulk resuming leads: ${err.message}`,
    });
  }
};

// To fetch cadences for move to cadence workflow
const getCadencesForMoveToCadenceWorflow = async (req, res) => {
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetcing user: ${err.message}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence',
        error: `User not found`,
      });

    let cadences = [],
      errForCadences = '';
    switch (req.user.role) {
      case USER_ROLE.SALES_PERSON:
        let [cadencesForSalesPerson, errForCadencesForSalesPerson] =
          await Repository.fetchAll({
            tableName: DB_TABLES.CADENCE,
            query: {
              [Op.or]: [
                // to see my personal cadences
                {
                  user_id: user.user_id,
                },
                // to see my company cadences
                {
                  company_id: user.company_id,
                },
                // to see my team cadences
                {
                  sd_id: user.sd_id,
                },
              ],
            },
            extras: {
              attributes: ['name', 'cadence_id'],
            },
          });
        if (errForCadencesForSalesPerson)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching cadences for move to cadence workflow: ${errForCadencesForSalesPerson}`,
          });
        cadences = cadencesForSalesPerson || [];
        break;
      case USER_ROLE.SALES_MANAGER:
      case USER_ROLE.SALES_MANAGER_PERSON:
        let [cadencesForSalesManager, errForCadencesForSalesManager] =
          await Repository.fetchAll({
            tableName: DB_TABLES.CADENCE,
            query: {
              [Op.or]: [
                // to see my team cadences
                {
                  sd_id: user.sd_id,
                },
                // to see personal cadences of all users who belong to my sd
                {
                  '$User.sd_id$': user.sd_id,
                },
                // to see my company cadences
                {
                  company_id: user.company_id,
                },
              ],
            },
            include: {
              [DB_TABLES.USER]: {
                attributes: [],
              },
            },
            extras: {
              attributes: ['name', 'cadence_id'],
            },
          });
        if (errForCadencesForSalesManager)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching cadences for move to cadence workflow: ${errForCadencesForSalesManager}`,
          });
        cadences = cadencesForSalesManager || [];
        break;
      case USER_ROLE.ADMIN:
      case USER_ROLE.SUPER_ADMIN:
        const [cadencesForAdmin, errForCadencesForAdmin] =
          await Repository.fetchAll({
            tableName: DB_TABLES.CADENCE,
            query: {},
            include: {
              [DB_TABLES.USER]: {
                where: {
                  company_id: user.company_id,
                },
                required: true,
                attributes: [],
              },
            },
            extras: {
              attributes: ['name', 'cadence_id'],
            },
          });
        if (errForCadencesForAdmin)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching cadences for move to cadence workflow: ${errForCadencesForAdmin}`,
          });
        cadences = cadencesForAdmin || [];
        break;

      default:
        return badRequestResponseWithDevMsg({
          res,
        });
    }
    logger.info(
      `Cadences fetched for move to cadence workflow: ${cadences?.length}`
    );
    return successResponse(
      res,
      `Fetched cadences successfully`,
      cadences || []
    );
  } catch (err) {
    logger.error(
      `Error while fetching cadences for move to cadence workflow: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadences for move to cadence workflow: ${err.message}`,
    });
  }
};
const toggleFavorite = async (req, res) => {
  try {
    const body = cadenceSchema.updateFavoriteSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    const [[cadence, errForCadence], [user, errForUser]] = await Promise.all([
      Repository.fetchOne({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id: req.params.id },
        include: {
          [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
          [DB_TABLES.SUB_DEPARTMENT]: {
            attributes: ['department_id'],
            [DB_TABLES.DEPARTMENT]: {
              attributes: ['company_id'],
            },
          },
        },
      }),
      Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: { user_id: req.user.user_id },
      }),
    ]);
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        error: `No cadence found`,
      });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({ res, error: errForCadence });
    if (errForUser)
      return serverErrorResponseWithDevMsg({ res, error: errForUser });

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence: cadence,
      user,
      action: CADENCE_ACTIONS.UPDATE,
    });

    if (errForAccess)
      return serverErrorResponseWithDevMsg({ res, error: errForAccess });
    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });

    const [isUpdated, errForUpdating] = await Repository.update({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id: req.params.id },
      updateObject: {
        favorite: req.body.favorite,
      },
    });
    if (errForUpdating)
      return serverErrorResponseWithDevMsg({ res, error: errForUpdating });

    return successResponse(res, `cadence updated Succesfully`);
  } catch (err) {
    logger.error(`Error while updating cadence`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating cadence: ${err.message}`,
    });
  }
};

const getGroupInfoOfGroupCadence = async (req, res) => {
  try {
    const { cadence_id } = req.params;
    if (!cadence_id)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: `Could not fetch info, please try after some time or contact support`,
        error: 'cadence_id not found.',
      });

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: {
        cadence_id,
      },
      include: {
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: ['sd_id', 'name'],
          [DB_TABLES.USER]: {
            attributes: [
              'user_id',
              'first_name',
              'last_name',
              'email',
              'role',
              'profile_picture',
              'is_profile_picture_present',
            ],
          },
        },
        [DB_TABLES.USER]: {
          attributes: [
            'user_id',
            'first_name',
            'last_name',
            'email',
            'role',
            'profile_picture',
            'is_profile_picture_present',
          ],
        },
      },
      extras: {
        attributes: [
          'cadence_id',
          'name',
          'sd_id',
          'company_id',
          'user_id',
          'type',
        ],
      },
    });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Could not fetch info of the cadence, try again after some time or contact support`,
        error: `Error in fetching group_info for the cadence: ${errForCadence}`,
      });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: `Cadence does not exist`,
        error: `Requested cadence does not exist.`,
      });

    let response = {
      cadence_id,
      cadence_name: cadence.name,
      users: [],
      sub_department: null,
      owner: cadence.User || {},
      type: cadence.type,
    };

    let cadence_type = cadence.type;

    if (cadence_type === CADENCE_TYPES.TEAM) {
      return badRequestResponseWithDevMsg({
        res,
        msg: `Something went wrong while fetching cadence info`,
        error: `Team cadences not supported`,
      });
      response.users = cadence?.Sub_Department?.Users || [];
      delete cadence?.Sub_Department?.Users;
      response.sub_department = cadence?.Sub_Department;
    }
    return successResponse(
      res,
      `Group info for the cadence fetched successfully.`,
      response
    );
  } catch (err) {
    logger.error(`Error in fetching group info of cadence: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching group info of group cadence: ${err.message}`,
    });
  }
};

// * Fetch timezones for lead
const getTimezonesForTaskFilter = async (req, res) => {
  try {
    let { user_id } = req.user;

    // Step: Fetch required timezones
    const [timezones, errForTimezones] = await Repository.fetchAll({
      tableName: DB_TABLES.DAILY_TASKS,
      query: {
        user_id,
      },
      include: {
        [DB_TABLES.TASK]: {
          where: {
            completed: {
              [Op.ne]: 1,
            },
          },
          required: true,
          attributes: ['task_id'],
          [DB_TABLES.LEAD]: {
            attributes: ['lead_id'],
            [DB_TABLES.LEAD_PHONE_NUMBER]: {
              where: {
                timezone: {
                  [Op.ne]: null,
                },
                is_primary: true,
              },
              attributes: ['timezone', 'time'],
              required: true,
            },
            required: true,
          },
        },
      },
      extras: {
        attributes: [
          [
            Sequelize.fn(
              'COUNT',
              Sequelize.col('Task.Lead.Lead_phone_numbers.timezone')
            ),
            'count',
          ],
        ],
        group: ['Task.Lead.Lead_phone_numbers.timezone'],
      },
    });
    if (errForTimezones)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch timezones in filter',
        error: errForTimezones,
      });

    return successResponse(
      res,
      'Successfully fetched timezones for filters',
      timezones
    );
  } catch (err) {
    logger.error(`Error in fetching group info of cadence: `, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching group info of group cadence: ${err.message}`,
    });
  }
};

/**
 * Stops all associated cadences for leads
 * @param {*} req
 * @param {*} res
 * @returns
 */
const bulkStopAllCadencesForLead = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { lead_ids } = req.body;
    logger.info(`Total lead ids to pause: ` + lead_ids?.length);
    successResponse(
      res,
      'Processing has been started, please check after some time.'
    );
    const [stopCadences, errForStopCadences] =
      await CadenceHelper.stopAllCadencesForLead(lead_ids, t);
    if (errForStopCadences) {
      t.rollback();
      logger.error(`Error while bulk stopping leads: `, errForStopCadences);
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while bulk stopping cadences for leads: ${errForStopCadences}`,
      });
    }
    // recalculate tasks for this user
    TaskHelper.recalculateDailyTasksForUsers([req.user.user_id]);
    t.commit();
  } catch (err) {
    t.rollback();
    logger.error(`Error while bulk stopping leads: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while bulk stopping leads: ${err.message}`,
    });
  }
};

const launchCadenceForProductTourCadence = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // destructure cadence id from params
    const { cadence_id } = req.params;

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.NODE]: { where: { is_first: 1 }, attributes: ['node_id'] },
      },
      t,
    });
    if (errForCadence) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to launch cadence',
        error: `Error while fetching cadence: ${errForCadence}`,
      });
    }
    if (!cadence) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected cadence does not exist',
        error: `Cadence not found`,
      });
    }
    // check if cadence is a product tour cadence
    if (
      cadence.salesforce_cadence_id !== INTEGRATION_ID_FOR_PRODUCT_TOUR_CADENCE
    ) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You cannot launch this cadence, please contact support',
        error: `Selected Cadence is not a product tour cadence`,
      });
    }
    if (cadence.status !== CADENCE_STATUS.NOT_STARTED) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        error: `Product tour cadence can only be launched`,
      });
    }
    if (!cadence?.Nodes?.length) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: `You can’t launch cadence with 0 steps`,
      });
    }
    const node_id = cadence?.Nodes?.[0]?.node_id;
    // Step: create tasks, create activities
    const rawQueryForTasks = `
    insert into task(name,start_time,shown_time,metadata,to_show,urgent_time,lead_id,user_id,node_id,completed,is_skipped,cadence_id, status, created_at,updated_at)
      select 
        -- hardcoding 3 as name since for product tour cadences mail is the first step as of 26 Oct 2023
        3 as name,
        :start_time as start_time,
        :start_time as shown_time,
        '{}' as metadata,
        1 as to_show,
        123 as urgent_time,
        lead_id,
        :user_id as user_id,
        :node_id as node_id,
        0 as completed,
        0 as is_skipped,
        :cadence_id as cadence_id,
        :status as status,
        now(),
        now()
      from lead_to_cadence 
      where 
      cadence_id=:cadence_id
    `;
    const tasksPromise = Repository.runRawQuery({
      rawQuery: rawQueryForTasks,
      tableName: DB_MODELS[DB_TABLES.TASK],
      include: [],
      replacements: {
        start_time: new Date().getTime(),
        user_id: req.user.user_id,
        node_id,
        cadence_id,
        status: TASK_STATUSES.INCOMPLETE,
      },
      extras: {
        type: QueryTypes.INSERT,
        returning: true,
      },
      t,
    });
    const dailyTasksDeletePromise = Repository.destroy({
      tableName: DB_TABLES.DAILY_TASKS,
      query: { user_id: req.user.user_id },
      t,
    });

    const [[tasks, errForTasks], [dailyTasksDeleted, errForDailyTasksDeleted]] =
      await Promise.all([tasksPromise, dailyTasksDeletePromise]);
    // console.log(tasks, errForTasks);
    if (errForTasks) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating tasks: ${errForTasks}`,
      });
    }
    if (errForDailyTasksDeleted) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating tasks: ${errForDailyTasksDeleted}`,
      });
    }

    const dailyTasks = tasks?.[0]?.map((task) => ({
      task_id: task.task_id,
      node_id,
      user_id: req.user.user_id,
    }));
    // console.log(dailyTasks);

    // get activity template
    const unixTime = Math.round(new Date().getTime() / 1000);
    const [activityFromTemplate, errForActivityFromTemplate] =
      ActivityHelper.getActivityFromTemplates({
        type: ACTIVITY_TYPE.LAUNCH_CADENCE,
        variables: {
          cadence_name: cadence.name,
          first_name: req.user.first_name,
          last_name: req.user.last_name,
          launch_at: unixTime,
        },
        activity: {},
      });
    const activityPromise = ActivityHelper.createActivityForLaunchResumeLeads({
      cadence_id,
      activity_name: activityFromTemplate.name,
      activity_status: activityFromTemplate.status,
      activity_type: activityFromTemplate.type,
      t,
    });
    const dailyTasksPromise = Repository.bulkCreate({
      tableName: DB_TABLES.DAILY_TASKS,
      createObject: dailyTasks,
      t,
    });
    const [
      [launchResumeActivity, errForLaunchResumeActivity],
      [createdDailyTasks, errForCreatedDailyTasks],
    ] = await Promise.all([activityPromise, dailyTasksPromise]);
    // console.log(createdDailyTasks, errForCreatedDailyTasks);
    if (errForLaunchResumeActivity) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating activity: ${errForLaunchResumeActivity}`,
      });
    }
    if (errForCreatedDailyTasks) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating tasks: ${errForCreatedDailyTasks}`,
      });
    }
    Repository.update({
      tableName: DB_TABLES.LEADTOCADENCE,
      query: { cadence_id },
      updateObject: {
        status: CADENCE_STATUS.IN_PROGRESS,
      },
    });
    Repository.update({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      updateObject: {
        status: CADENCE_STATUS.IN_PROGRESS,
        launch_at: new Date(),
        unix_resume_at: null,
      },
    });
    SocketHelper.sendRecalculateEvent({
      user_id: req.user.user_id,
      email: req.user.email,
    });
    t.commit();
    return successResponse(res, `Successfully launched cadence`);
  } catch (err) {
    t.rollback();
    logger.error(`Error while launching product tour cadence: `, {
      user_id: req.user.user_id,
      error: err.message,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while launching product tour cadence: ${err.message}`,
    });
  }
};

const CadenceController = {
  createCadence,
  deleteManyCadence,
  getAllCadences,
  getAllCadencesNameAndId,
  getCadence,
  getAllLeadsForCadence,
  getCadenceLeadsStats,
  stopCurrentCadenceForLead,
  getCadencesForTaskFilter,
  getCadencesForLeadFilter,
  duplicateCadence,
  shareCadence,
  checkWorkflowInCadence,
  getCadenceStatistics,
  reassignLeadsAndContacts,
  getTestMailUsers,
  getAllowedStatuses,
  bulkPauseCadenceForLead,
  bulkStopCadenceForLead,
  bulkResumeCadenceForLead,
  getCadenceStatisticsLeads,
  getCadenceMailStatisticsLeads,
  getCadenceMessageStatisticsLeads,
  getCadencesForMoveToCadenceWorflow,
  toggleFavorite,
  getGroupInfoOfGroupCadence,
  getTimezonesForTaskFilter,
  bulkStopAllCadencesForLead,
  launchCadenceForProductTourCadence,
};

module.exports = CadenceController;

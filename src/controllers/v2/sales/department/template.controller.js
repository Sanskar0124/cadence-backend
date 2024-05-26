// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  USER_ROLE,
  TEMPLATE_TYPE,
  TEMPLATE_LEVEL,
  TEMPLATE_ACTIONS,
  TEMPLATE_LABELS,
  TEMPLATE_ID_MAP,
  TEMPLATE_STATS_TYPE,
  EMAIL_STATUS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');
const { Op } = require('sequelize');

// Packages
const { customAlphabet } = require('nanoid');
const alphabet = '0123456789ABCDEFGHIJKLMNOU';
const nanoid = customAlphabet(alphabet, 32);

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const AttachmentRepository = require('../../../../../../Cadence-Brain/src/repository/attachment.repository');

// Helpers and Services
const TemplateHelper = require('../../../../../../Cadence-Brain/src/helper/template');
const AttachmentHelper = require('../../../../../../Cadence-Brain/src/helper/attachments/');
const JsonHelper = require('../../../../../../Cadence-Brain/src/helper/json');
const Storage = require('../../../../../../Cadence-Brain/src/services/Google/Storage');

// Joi validation
const templatesSchema = require('../../../../joi/v2/sales/department/templates.joi');

const TEMPLATE_TABLE_MAP = {
  [TEMPLATE_TYPE.EMAIL]: DB_TABLES.EMAIL_TEMPLATE,
  [TEMPLATE_TYPE.LINKEDIN]: DB_TABLES.LINKEDIN_TEMPLATE,
  [TEMPLATE_TYPE.WHATSAPP]: DB_TABLES.WHATSAPP_TEMPLATE,
  [TEMPLATE_TYPE.SCRIPT]: DB_TABLES.SCRIPT_TEMPLATE,
  [TEMPLATE_TYPE.SMS]: DB_TABLES.MESSAGE_TEMPLATE,
  [TEMPLATE_TYPE.VIDEO]: DB_TABLES.VIDEO_TEMPLATE,
};

const getAllTemplates = async (req, res) => {
  try {
    // currently logged in user

    const { type, level, brief, users, get_count, sortMethod, sortOrder } =
      req.query;

    if (!Object.values(TEMPLATE_LEVEL).includes(level))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch templates',
        error: 'Provide a valid template level',
      });

    if (!get_count) {
      if (!Object.values(TEMPLATE_TYPE).includes(type))
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to fetch templates',
          error: 'Provide a valid template type',
        });
    }

    //const [user, errForUser] = await Repository.fetchOne({
    //tableName: DB_TABLES.USER,
    //query: { user_id: req.user.user_id },
    //});

    //if (errForUser)
    //return serverErrorResponseWithDevMsg({
    //res,
    //msg: 'Failed to fetch templates',
    //error: `Error while fetching user: ${errForUser}`,
    //});
    //if (!user)
    //return badRequestResponseWithDevMsg({
    //res,
    //msg: 'Failed to fetch templates',
    //error: 'User not found',
    //});

    // type: email / message / linkedin / script

    let user = req.user;
    let query = {},
      include = {};

    switch (level) {
      case TEMPLATE_LEVEL.PERSONAL:
        {
          switch (user.role) {
            case USER_ROLE.SALES_PERSON: {
              query = {
                user_id: user.user_id,
                level: TEMPLATE_LEVEL.PERSONAL,
              };
              include = {
                [DB_TABLES.USER]: {
                  attributes: [
                    'first_name',
                    'last_name',
                    'is_profile_picture_present',
                    'profile_picture',
                    'user_id',
                  ],
                  where: {
                    company_id: user.company_id,
                  },
                  required: true,
                  [DB_TABLES.SUB_DEPARTMENT]: {
                    attributes: [
                      'name',
                      'sd_id',
                      'is_profile_picture_present',
                      'profile_picture',
                    ],
                    //[DB_TABLES.DEPARTMENT]: {
                    //attributes: ['department_id'],
                    //[DB_TABLES.COMPANY]: {
                    //where: {
                    //company_id: user.company_id,
                    //},
                    //attributes: ['company_id'],
                    //},
                    //},
                    required: true,
                  },
                },
              };
              break;
            }
            case USER_ROLE.SALES_MANAGER: {
              query = {
                level: TEMPLATE_LEVEL.PERSONAL,
              };
              include = {
                [DB_TABLES.USER]: {
                  required: true,
                  where: {
                    [Op.or]: [
                      {
                        role: USER_ROLE.SALES_PERSON,
                        sd_id: user.sd_id,
                        company_id: user.company_id,
                        user_id: users ? users : { [Op.ne]: null },
                      },
                      {
                        user_id: users ? users : user.user_id,
                      },
                    ],
                  },
                  attributes: [
                    'first_name',
                    'last_name',
                    'is_profile_picture_present',
                    'profile_picture',
                    'user_id',
                  ],
                  [DB_TABLES.SUB_DEPARTMENT]: {
                    attributes: [
                      'name',
                      'sd_id',
                      'is_profile_picture_present',
                      'profile_picture',
                    ],
                    //[DB_TABLES.DEPARTMENT]: {
                    //attributes: ['department_id'],
                    //[DB_TABLES.COMPANY]: {
                    //where: {
                    //company_id: user.company_id,
                    //},
                    //attributes: ['company_id'],
                    //required: true,
                    //},
                    //required: true,
                    //},
                    required: true,
                  },
                },
              };
              break;
            }
            case USER_ROLE.SUPER_ADMIN:
            case USER_ROLE.ADMIN: {
              query = {
                level: TEMPLATE_LEVEL.PERSONAL,
              };
              include = {
                [DB_TABLES.USER]: {
                  attributes: [
                    'first_name',
                    'last_name',
                    'is_profile_picture_present',
                    'profile_picture',
                    'user_id',
                  ],
                  where: {
                    [Op.or]: [
                      {
                        role: [USER_ROLE.SALES_PERSON, USER_ROLE.SALES_MANAGER],
                        company_id: user.company_id,
                        user_id: users ? users : { [Op.ne]: null },
                      },
                      {
                        user_id: users ? users : user.user_id,
                      },
                    ],
                  },
                  [DB_TABLES.SUB_DEPARTMENT]: {
                    attributes: [
                      'name',
                      'sd_id',
                      'is_profile_picture_present',
                      'profile_picture',
                    ],
                    //[DB_TABLES.DEPARTMENT]: {
                    //attributes: ['department_id'],
                    //[DB_TABLES.COMPANY]: {
                    //where: {
                    //company_id: user.company_id,
                    //},
                    //attributes: ['company_id'],
                    //required: true,
                    //},
                    //required: true,
                    //},
                    required: true,
                  },
                },
                //[DB_TABLES.SUB_DEPARTMENT]: {
                //attributes: [
                //'name',
                //'sd_id',
                //'is_profile_picture_present',
                //'profile_picture',
                //],
                //[DB_TABLES.DEPARTMENT]: {
                //where: {
                //company_id: user.company_id,
                //},
                //},
                //},
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

      // Team cadences
      case TEMPLATE_LEVEL.TEAM:
        {
          // Switch according to role
          switch (user.role) {
            case USER_ROLE.SALES_PERSON:
            case USER_ROLE.SALES_MANAGER: {
              query = { sd_id: user.sd_id, level: TEMPLATE_LEVEL.TEAM };
              include = {
                [DB_TABLES.USER]: {
                  attributes: [
                    'user_id',
                    'first_name',
                    'last_name',
                    'is_profile_picture_present',
                    'profile_picture',
                  ],
                  //where: {
                  //sd_id: user.sd_id,
                  //},
                  [DB_TABLES.SUB_DEPARTMENT]: {
                    attributes: [
                      'name',
                      'sd_id',
                      'is_profile_picture_present',
                      'profile_picture',
                    ],
                    //where: {
                    //sd_id: user.sd_id,
                    //},
                    //[DB_TABLES.DEPARTMENT]: {
                    //attributes: ['department_id'],
                    //[DB_TABLES.COMPANY]: {
                    //where: {
                    //company_id: user.company_id,
                    //},
                    //attributes: ['company_id'],
                    //},
                    //required: true,
                    //},
                    required: true,
                  },
                  required: true,
                },
                [DB_TABLES.SUB_DEPARTMENT]: {
                  attributes: ['name', 'sd_id'],
                  //[DB_TABLES.DEPARTMENT]: {
                  //[DB_TABLES.COMPANY]: {
                  //where: { company_id: user.company_id },
                  //},
                  //// required: true,
                  //},
                  // required: true,
                },
              };
              break;
            }
            case USER_ROLE.SUPER_ADMIN:
            case USER_ROLE.ADMIN: {
              query = {
                level: TEMPLATE_LEVEL.TEAM,
              };
              include = {
                [DB_TABLES.USER]: {
                  sd_id: user.sd_id,
                  attributes: [
                    'first_name',
                    'last_name',
                    'user_id',
                    'is_profile_picture_present',
                    'profile_picture',
                  ],
                  required: true,
                  where: {
                    company_id: user.company_id,
                  },
                  [DB_TABLES.SUB_DEPARTMENT]: {
                    attributes: [
                      'name',
                      'sd_id',
                      'is_profile_picture_present',
                      'profile_picture',
                    ],
                    //[DB_TABLES.DEPARTMENT]: {
                    //attributes: ['department_id'],
                    //[DB_TABLES.COMPANY]: {
                    //where: {
                    //company_id: user.company_id,
                    //},
                    //attributes: ['company_id'],
                    //required: true,
                    //},
                    //},
                    required: true,
                  },
                },
                // [DB_TABLES.SUB_DEPARTMENT]: {
                //   attributes: [
                //     'name',
                //     'sd_id',
                //     'is_profile_picture_present',
                //     'profile_picture',
                //   ],
                //   [DB_TABLES.DEPARTMENT]: {
                //     [DB_TABLES.COMPANY]: {
                //       where: { company_id: user.company_id },
                //     },
                //   },
                // },
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

      // Company cadences
      case TEMPLATE_LEVEL.COMPANY: {
        query = {
          level: TEMPLATE_LEVEL.COMPANY,
          company_id: user.company_id,
          user_id: users ? users : { [Op.not]: null },
        };
        include = {
          [DB_TABLES.USER]: {
            attributes: [
              'first_name',
              'last_name',
              'is_profile_picture_present',
              'profile_picture',
              'user_id',
            ],
            [DB_TABLES.SUB_DEPARTMENT]: {
              attributes: [
                'name',
                'sd_id',
                'is_profile_picture_present',
                'profile_picture',
              ],
            },
          },
          //[DB_TABLES.SUB_DEPARTMENT]: {
          //[DB_TABLES.DEPARTMENT]: {
          //[DB_TABLES.COMPANY]: {
          //company_id: user.company_id,
          //},
          //},
          //},
          required: true,
        };
        break;
      }
    }

    let extrasQuery = {
      required: true,
      attributes: [
        'name',
        'level',
        'user_id',
        'sd_id',
        'company_id',
        'created_at',
      ],
      order: [['created_at', 'DESC']],
    };

    const { limit, offset } = req.query;

    // if (users) {
    //   let alreadyPresentUserId =

    // let alreadyPresentUserId = include[DB_TABLES.USER].where[Op.or][1].user_id;

    // include = {
    //   ...include,
    //   [DB_TABLES.USER]: {
    //     ...include[DB_TABLES.USER],
    //     attributes: [
    //       'first_name',
    //       'last_name',
    //       'is_profile_picture_present',
    //       'profile_picture',
    //       'user_id',
    //     ],
    //     where: {
    //       ...include[DB_TABLES.USER].where,
    //       [Op.or]: {
    //         user_id: users
    //           ? users
    //           : alreadyPresentUserId
    //           ? alreadyPresentUserId
    //           : { [Op.ne]: null },
    //       },
    //     },
    //   },
    // };

    // if (req.query?.limit) extrasQuery.limit = parseInt(req.query.limit);
    // if (req.query?.offset) extrasQuery.offset = parseInt(req.query.offset);

    // console.log(include);

    if (get_count) {
      let totalTemplates = 0;

      const emailTemplates = await Repository.count({
        tableName: DB_TABLES.EMAIL_TEMPLATE,
        query,
        include,
        extras: extrasQuery,
      });
      const linkedinTemplates = await Repository.count({
        tableName: DB_TABLES.LINKEDIN_TEMPLATE,
        query,
        include,
        extras: extrasQuery,
      });
      const whatsappTemplates = await Repository.count({
        tableName: DB_TABLES.WHATSAPP_TEMPLATE,
        query,
        include,
        extras: extrasQuery,
      });
      const scriptTemplates = await Repository.count({
        tableName: DB_TABLES.SCRIPT_TEMPLATE,
        query,
        include,
        extras: extrasQuery,
      });

      const messageTemplates = await Repository.count({
        tableName: DB_TABLES.MESSAGE_TEMPLATE,
        query,
        include,
        extras: extrasQuery,
      });

      const videoTemplates = await Repository.count({
        tableName: DB_TABLES.VIDEO_TEMPLATE,
        query,
        include,
        extras: extrasQuery,
      });

      totalTemplates =
        emailTemplates[0] +
        linkedinTemplates[0] +
        whatsappTemplates[0] +
        scriptTemplates[0] +
        messageTemplates[0] +
        videoTemplates[0];

      return successResponse(res, 'Count received', totalTemplates);
    } else {
      switch (type) {
        case TEMPLATE_TYPE.EMAIL:
          {
            tableName = DB_TABLES.EMAIL_TEMPLATE;
            extrasQuery.attributes.push('subject');
            extrasQuery.attributes.push('et_id');
            extrasQuery.attributes.push('body');

            include[DB_TABLES.EMAIL] = {};
            include[DB_TABLES.ATTACHMENT] = {
              separate: true,
            };

            let attributes = [
              [
                sequelize.literal(
                  `SUM(
                      CASE 
                        WHEN Emails.sent = true THEN 1
                        ELSE 0
                      END
                    )
                  `
                ),
                'sent',
              ],
              [
                sequelize.literal(`
              SUM(
                CASE WHEN Emails.status = 'clicked' and sent=true THEN 1 ELSE 0 END
              )
            `),
                'clicked',
              ],
              [
                sequelize.literal(`
              SUM(
                CASE 
                  WHEN Emails.status = 'bounced' and sent=true THEN 1
                  ELSE 0
                END
              )
            `),
                'bounced',
              ],
              [
                sequelize.literal(`
              SUM(
                CASE 
                  WHEN Emails.status = 'opened' and sent=true THEN 1
                  WHEN Emails.status = 'clicked' and sent=true THEN 1
                  ELSE 0
                END
              )
            `),
                'opened',
              ],
              [
                sequelize.literal(`
              SUM(
                CASE 
                  WHEN Emails.sent = false THEN 1
                  ELSE 0
                END
              )
            `),
                'replied',
              ],

              [
                sequelize.literal(`
              SUM(
                CASE 
                  WHEN Emails.unsubscribed = true THEN 1
                  ELSE 0
                END
              )
            `),
                'unsubscribed',
              ],

              'body',
              'created_at',
              'level',
              'linkText',
              'name',
              'redirectUrl',
              'sd_id',
              'subject',
              'user_id',
              'et_id',
            ];

            if (!brief) extrasQuery.attributes = attributes;
            extrasQuery.group = ['et_id'];

            if (sortMethod && sortOrder) {
              extrasQuery.order = [[sequelize.literal(sortMethod), sortOrder]];
            }
          }
          break;
        case TEMPLATE_TYPE.LINKEDIN:
          {
            extrasQuery.attributes.push('message');
            extrasQuery.attributes.push('lt_id');
          }
          break;
        case TEMPLATE_TYPE.WHATSAPP:
          {
            extrasQuery.attributes.push('message');
            extrasQuery.attributes.push('wt_id');
          }
          break;
        case TEMPLATE_TYPE.SMS:
          {
            extrasQuery.attributes.push('message');
            extrasQuery.attributes.push('mt_id');
          }
          break;
        case TEMPLATE_TYPE.SCRIPT:
          {
            extrasQuery.attributes.push('script');
            extrasQuery.attributes.push('st_id');
          }
          break;
        case TEMPLATE_TYPE.VIDEO:
          {
            extrasQuery.attributes.push('vt_id');
            extrasQuery.group = ['vt_id'];
            include[DB_TABLES.VIDEO] = {
              attributes: [
                'video_id',
                'file_name',
                'video_url',
                'is_thumbnail_present',
                'thumbnail_url',
                'video_duration',
              ],
              required: true,
            };
            include[DB_TABLES.VIDEO_TRACKING] = {
              attributes: [
                [
                  sequelize.literal(`COUNT(DISTINCT video_tracking_id) `),
                  'sent',
                ],
                [sequelize.literal(`SUM(watch_duration) `), 'total_duration'],
                [
                  sequelize.literal(
                    `SUM(CASE WHEN is_visited=true THEN 1 ELSE 0 END) `
                  ),
                  'clicked',
                ],
              ],
            };
          }
          break;
      }

      let [templates, errForTemplates] = await Repository.fetchAll({
        tableName: TEMPLATE_TABLE_MAP[type],
        query,
        include,
        extras: extrasQuery,
      });

      if (errForTemplates)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch templates',
          error: `Error while fetching templates: ${errForTemplates}`,
        });

      if (templates.length === 0)
        return successResponse(res, 'No templates found.', []);

      if (limit && offset) {
        templates = templates.slice(parseInt(offset));
        templates = templates.slice(0, parseInt(limit));
      } else if (limit) templates = templates.slice(0, parseInt(limit));
      else if (offset) templates = templates.slice(parseInt(offset));

      return successResponse(res, 'Templates fetched successfully', templates);
    }
  } catch (err) {
    logger.error('Error while fetching template: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching templates: ${err.message}`,
    });
  }
};

const getLeadsForTemplate = async (req, res) => {
  try {
    const { et_id, status } = req.query;

    let emailQuery;

    if (!et_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch leads',
        error: `Provide a valid template id`,
      });

    switch (status) {
      case TEMPLATE_STATS_TYPE.BOUNCED:
        emailQuery = {
          et_id,
          status: EMAIL_STATUS.BOUNCED,
        };
        break;
      case TEMPLATE_STATS_TYPE.VIEWED:
        emailQuery = {
          et_id,
          status: [EMAIL_STATUS.CLICKED, EMAIL_STATUS.OPENED],
        };
        break;
      case TEMPLATE_STATS_TYPE.CLICKED:
        emailQuery = {
          et_id,
          status: EMAIL_STATUS.CLICKED,
        };
        break;
      case TEMPLATE_STATS_TYPE.UNSUBSCRIBED:
        emailQuery = {
          et_id,
          unsubscribed: true,
        };
        break;
      case TEMPLATE_STATS_TYPE.REPLIED:
        emailQuery = {
          et_id,
          sent: false,
        };
        break;
      default:
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to fetch leads',
          error: 'Provide a valid status',
        });
    }

    const [leads, errForLeads] = await Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      extras: {
        attributes: [
          'lead_id',
          'first_name',
          'last_name',
          'salesforce_lead_id',
          'salesforce_contact_id',
          'integration_type',
          'integration_id',
        ],
      },
      include: {
        [DB_TABLES.USER]: {
          required: true,
          attributes: ['first_name', 'last_name'],
        },
        [DB_TABLES.EMAIL]: {
          where: emailQuery,
          required: true,
          attributes: [],
        },
      },
    });
    if (errForLeads) {
      logger.error(`Error while fetching leads `, errForLeads);

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch leads',
        error: `Error while fetching leads: ${errForLeads.message}`,
      });
    }

    return successResponse(res, 'Fetched leads', leads);
  } catch (err) {
    logger.error(
      `Error while fetching leads for email template statsitics: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching leads for email template statistics: ${err.message}`,
    });
  }
};

// not in use
const getAllTemplatesForImport = async (req, res) => {
  try {
    let { type } = req.query;

    if (!Object.values(TEMPLATE_TYPE).includes(type))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch templates',
        error: 'Provide a valid template type',
      });

    let user = req.user;
    let errForUser;

    [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: user.user_id },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch templates',
        error: `Error while fecthing user: ${errForUser}`,
      });

    let tableName = '';
    switch (type) {
      case TEMPLATE_TYPE.EMAIL:
        tableName = DB_TABLES.EMAIL_TEMPLATE;
        break;
      case TEMPLATE_TYPE.SCRIPT:
        tableName = DB_TABLES.SCRIPT_TEMPLATE;
        break;
      case TEMPLATE_TYPE.SMS:
        tableName = DB_TABLES.MESSAGE_TEMPLATE;
        break;
      case TEMPLATE_TYPE.LINKEDIN:
        tableName = DB_TABLES.LINKEDIN_TEMPLATE;
        break;
      case TEMPLATE_TYPE.WHATSAPP:
        tableName = DB_TABLES.WHATSAPP_TEMPLATE;
        break;
      default:
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to fetch templates',
          error: 'Select a valid type',
        });
    }

    let personalTemplates,
      errForPersonalTemplates,
      groupTemplates,
      errForGroupTemplates,
      companyTemplates,
      errForCompanyTemplates;

    switch (user.role) {
      case USER_ROLE.SALES_PERSON: {
        [personalTemplates, errForPersonalTemplates] =
          await Repository.fetchAll({
            tableName,
            query: {
              level: TEMPLATE_LEVEL.PERSONAL,
              user_id: user.user_id,
            },
          });
        [groupTemplates, errForGroupTemplates] = await Repository.fetchAll({
          tableName,
          query: {
            level: TEMPLATE_LEVEL.TEAM,
            sd_id: user.sd_id,
          },
        });
        [companyTemplates, errForCompanyTemplates] = await Repository.fetchAll({
          tableName,
          query: {
            level: TEMPLATE_LEVEL.COMPANY,
            company_id: user.company_id,
          },
        });
      }

      case USER_ROLE.SALES_MANAGER: {
        [personalTemplates, errForPersonalTemplates] =
          await Repository.fetchAll({
            tableName,
            query: {
              level: TEMPLATE_LEVEL.PERSONAL,
            },
            include: {
              [DB_TABLES.USER]: {
                where: {
                  [Op.or]: [
                    {
                      sd_id: user.sd_id,
                      role: USER_ROLE.SALES_PERSON,
                    },
                    {
                      user_id: user.user_id,
                    },
                  ],
                },
              },
            },
          });
        [groupTemplates, errForGroupTemplates] = await Repository.fetchAll({
          tableName,
          query: {
            level: TEMPLATE_LEVEL.TEAM,
          },
          include: {
            [DB_TABLES.USER]: {
              attributes: ['first_name', 'last_name'],
              where: {
                sd_id: user.sd_id,
                role: [USER_ROLE.SALES_PERSON, USER_ROLE.SALES_MANAGER],
              },
              required: true,
            },
          },
        });
        [companyTemplates, errForCompanyTemplates] = await Repository.fetchAll({
          tableName,
          query: {
            level: TEMPLATE_LEVEL.COMPANY,
            company_id: user.company_id,
          },
        });
      }
      case USER_ROLE.SUPER_ADMIN:
      case USER_ROLE.ADMIN:
        {
          [personalTemplates, errForPersonalTemplates] =
            await Repository.fetchAll({
              tableName,
              query: {
                level: TEMPLATE_LEVEL.PERSONAL,
              },
              include: {
                [DB_TABLES.USER]: {
                  attributes: ['first_name', 'last_name'],
                  where: {
                    [Op.or]: [
                      {
                        role: [USER_ROLE.SALES_PERSON, USER_ROLE.SALES_MANAGER],
                      },
                      {
                        user_id: user.user_id,
                      },
                    ],
                  },
                },
                [DB_TABLES.SUB_DEPARTMENT]: {
                  [DB_TABLES.DEPARTMENT]: {
                    where: {
                      company_id: user.company_id,
                    },
                  },
                },
              },
            });
          [groupTemplates, errForGroupTemplates] = await Repository.fetchAll({
            tableName,
            query: {
              level: TEMPLATE_LEVEL.TEAM,
            },
            include: {
              [DB_TABLES.USER]: {
                attributes: ['first_name', 'last_name'],
              },
              [DB_TABLES.SUB_DEPARTMENT]: {
                attributes: ['name', 'sd_id'],
                [DB_TABLES.DEPARTMENT]: {
                  [DB_TABLES.COMPANY]: {
                    where: { company_id: user.company_id },
                  },
                  required: true,
                },
                required: true,
              },
            },
          });
          [companyTemplates, errForCompanyTemplates] =
            await Repository.fetchAll({
              tableName,
              query: {
                level: TEMPLATE_LEVEL.COMPANY,
              },
              include: {
                [DB_TABLES.USER]: {
                  attributes: ['first_name', 'last_name'],
                },
                [DB_TABLES.SUB_DEPARTMENT]: {
                  [DB_TABLES.DEPARTMENT]: {
                    [DB_TABLES.COMPANY]: {
                      company_id: user.company_id,
                    },
                  },
                },
              },
            });
        }

        if (
          errForPersonalTemplates ||
          errForGroupTemplates ||
          errForCompanyTemplates
        )
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch templates',
            error: `Error while fetching templates: ${
              errForPersonalTemplates ||
              errForGroupTemplates ||
              errForCompanyTemplates
            }`,
          });
        let templates = [
          ...personalTemplates,
          ...groupTemplates,
          ...companyTemplates,
        ];
        return successResponse(res, 'Fetched all templates', templates);
    }
  } catch (err) {
    logger.error('Error while fetching templates for import: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching templates for import: ${err.message}`,
    });
  }
};

const createTemplate = async (req, res) => {
  const TEMPLATE_CREATE_SCHEMA = {
    [TEMPLATE_TYPE.EMAIL]: templatesSchema.createEmailTemplateSchema,
    [TEMPLATE_TYPE.LINKEDIN]: templatesSchema.createLinkedInTemplateSchema,
    [TEMPLATE_TYPE.WHATSAPP]: templatesSchema.createWhatsappTemplateSchema,
    [TEMPLATE_TYPE.SCRIPT]: templatesSchema.createScriptTemplateSchema,
    [TEMPLATE_TYPE.SMS]: templatesSchema.createMessageTemplateSchema,
    [TEMPLATE_TYPE.VIDEO]: templatesSchema.createVideoTemplateSchema,
  };

  try {
    const { type } = req.body;
    if (!Object.values(TEMPLATE_TYPE).includes(type))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Error while creating a template',
        error: 'Provide a valid template type',
      });

    let template;

    const body = TEMPLATE_CREATE_SCHEMA[type].validate(req.body);
    if (body.error) {
      if (body.error?.message?.toLowerCase()?.includes('total length allowed'))
        return unprocessableEntityResponseWithDevMsg({
          res,
          msg: body.error.message,
        });
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    template = req.body;
    template.user_id = req.user.user_id;

    let [user, errForUser] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while creating a template',
        error: `Error while fetching user by query: ${errForUser}`,
      });

    const [access, errForAccess] = TemplateHelper.checkTemplateActionAccess({
      template,
      user,
      action: TEMPLATE_ACTIONS.CREATE,
    });

    if (errForAccess)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while creating a template',
        error: `Error while checking template action access: ${errForAccess}`,
      });

    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });

    template.user_id = req.user.user_id;

    if (template.sd_id === 'null') template.sd_id = null;
    if (template.company_id === 'null') template.company_id = null;

    let [newTemplate, errForNewTemplate] = await Repository.create({
      tableName: TEMPLATE_TABLE_MAP[type],
      createObject: template,
    });

    if (errForNewTemplate)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while creating a template',
        error: `Error while creating template: ${errForNewTemplate}`,
      });

    if (type === TEMPLATE_TYPE.EMAIL) {
      /**
       *
       * if (req.files) {
       *  const promiseArray = req.files.map((file) =>
       *    AttachmentRepository.createAttachment({
       *      original_name: file.originalname,
       *      content: file.buffer,
       *      content_type: file.mimetype,
       *      et_id: newTemplate.et_id,
       *    })
       *  );
       *
       *  await Promise.all(promiseArray);
       */

      /**
       * Update the attachments sent in the request
       * To Have Email Template Id
       */
      let attachment_ids = req.body?.attachment_ids;
      const [updatedAttachments, errForUpdatedAttachments] =
        await Repository.update({
          tableName: DB_TABLES.ATTACHMENT,
          query: {
            attachment_id: {
              [Op.in]: attachment_ids,
            },
          },
          updateObject: {
            et_id: newTemplate?.et_id,
          },
        });
    }

    return successResponse(
      res,
      `${TEMPLATE_LABELS[type]} template created.`,
      newTemplate
    );
  } catch (err) {
    logger.error('Error while creating template', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating template: ${err.message}`,
    });
  }
};

const duplicateTemplate = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { type } = req.body;

    if (!Object.values(TEMPLATE_TYPE).includes(type)) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create duplicate template',
        error: 'Provide a valid template type',
      });
    }

    const TEMPLATE_DUPLICATE_SCHEMA = {
      [TEMPLATE_TYPE.EMAIL]: templatesSchema.duplicateEmailTemplateSchema,
      [TEMPLATE_TYPE.LINKEDIN]: templatesSchema.duplicateLinkedinTemplateSchema,
      [TEMPLATE_TYPE.WHATSAPP]: templatesSchema.duplicateWhatsappTemplateSchema,
      [TEMPLATE_TYPE.SCRIPT]: templatesSchema.duplicateScriptTemplateSchema,
      [TEMPLATE_TYPE.SMS]: templatesSchema.duplicateMessageTemplateSchema,
      [TEMPLATE_TYPE.VIDEO]: templatesSchema.duplicateVideoTemplateSchema,
    };

    const body = TEMPLATE_DUPLICATE_SCHEMA[type].validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    let idString = TEMPLATE_ID_MAP[type];
    let templateId = req.body[idString];

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });

    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create duplicate template',
        error: `Error while fetching user: ${errForUser}`,
      });
    }

    const [ogTemplate, errForOgTemplate] = await Repository.fetchOne({
      tableName: TEMPLATE_TABLE_MAP[type],
      query: { [TEMPLATE_ID_MAP[type]]: templateId },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
        [DB_TABLES.SUB_DEPARTMENT]: {
          [DB_TABLES.DEPARTMENT]: {
            attributes: ['company_id'],
          },
          attributes: ['sd_id', 'department_id'],
        },
      },
    });

    if (errForOgTemplate) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create duplicate template',
        error: `Error while fetching template table map: ${errForOgTemplate}`,
      });
    }

    if (!ogTemplate) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create duplicate template',
        error: `No template found`,
      });
    }

    let fileName, newFileName, videoDuration;
    if (type == TEMPLATE_TYPE.VIDEO) {
      req.body.video_id = req.body.Video.video_id;
      videoDuration = req.body.Video.video_duration;
      fileName = req.body.Video.file_name;
      delete req.body.Video;
      delete req.body.Video_Trackings;
    }

    const [access, errForAccess] = TemplateHelper.checkTemplateActionAccess({
      template: req.body,
      user,
      action: TEMPLATE_ACTIONS.DUPLICATE,
      data: { ogTemplate },
    });

    if (errForAccess) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create duplicate template',
        error: `Error while checking template action access: ${errForAccess}`,
      });
    }

    if (!access) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });
    }

    delete req.body[TEMPLATE_ID_MAP[type]];
    req.body.user_id = req.user.user_id;

    if (type == TEMPLATE_TYPE.VIDEO) {
      newFileName = nanoid();

      const [video, errForVideo] = await Repository.create({
        tableName: DB_TABLES.VIDEO,
        createObject: {
          file_name: newFileName,
          user_id: req.user.user_id,
          is_thumbnail_present: true,
          video_duration: videoDuration,
        },
      });
      if (errForVideo) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create duplicate template',
          error: `Error while creating video: ${errForVideo}`,
        });
      }

      const [videoUrl, errForVideoUrl] = await Storage.Bucket.duplicateVideo(
        fileName,
        newFileName
      );
      if (errForVideoUrl) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create duplicate template',
          error: `Error for duplicate video: ${errForVideoUrl}`,
        });
      }

      const [ThumbnailUrl, errForThumbnailUrl] =
        await Storage.Bucket.duplicateThumbnail(fileName, newFileName);
      if (errForThumbnailUrl) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create duplicate template',
          error: `Error for duplicate thumbnail: ${errForThumbnailUrl}`,
        });
      }

      req.body.video_id = video.video_id;
    }

    if (type === TEMPLATE_TYPE.EMAIL) {
      req.body.linkText = ogTemplate.linkText ? ogTemplate.linkText : '';
      req.body.redirectUrl = ogTemplate.redirectUrl
        ? ogTemplate.redirectUrl
        : '';
    }

    const [_template, _errForTemplate] = await Repository.create({
      tableName: TEMPLATE_TABLE_MAP[type],
      createObject: req.body,
    });

    if (_errForTemplate) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create duplicate template',
        error: `Error while creating template table map: ${_errForTemplate}`,
      });
    }

    // find all attachements of the original template
    // create new attachments referring to the duplicated new template
    if (type === TEMPLATE_TYPE.EMAIL) {
      let [attachments, errForAttachments] =
        await AttachmentRepository.getAttachments({ et_id: ogTemplate.et_id });
      if (errForAttachments) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create duplicate template',
          error: `Error while fetching attachments: ${errForAttachments}`,
        });
      }

      attachments = JsonHelper.parse(attachments);

      if (attachments?.length > 0) {
        const promiseArray = attachments.map((attachment) => {
          return AttachmentRepository.createAttachment({
            original_name: attachment.original_name,
            et_id: _template.et_id,
          });
        });

        await Promise.all(promiseArray);

        const [newAttachments, errForNewAttachments] =
          await Repository.fetchAll({
            tableName: DB_TABLES.ATTACHMENT,
            query: { et_id: _template.et_id },
          });
        if (errForNewAttachments) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to create duplicate template',
            error: `Error while fetching new attachments: ${errForNewAttachments}`,
          });
        }

        let duplicateAttachmentsPromise = [];

        for (let i = 0; i < attachments.length; i++) {
          duplicateAttachmentsPromise.push(
            Storage.Bucket.duplicateAttachment(
              attachments[i].attachment_id,
              newAttachments[i].attachment_id,
              newAttachments[i].original_name
            )
          );
        }

        await Promise.all(duplicateAttachmentsPromise);
      }
    }

    t.commit();
    return successResponse(res, 'Template duplicated successfully', _template);
  } catch (err) {
    t.rollback();
    logger.error(`Error while creating a duplicate template: ${err.message}`);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating a duplicate template: ${err.message}`,
    });
  }
};

const shareTemplate = async (req, res) => {
  const TEMPLATE_SHARE_SCHEMA = {
    [TEMPLATE_TYPE.EMAIL]: templatesSchema.shareEmailTemplateSchema,
    [TEMPLATE_TYPE.LINKEDIN]: templatesSchema.shareLinkedinTemplateSchema,
    [TEMPLATE_TYPE.WHATSAPP]: templatesSchema.shareWhatsappTemplateSchema,
    [TEMPLATE_TYPE.SCRIPT]: templatesSchema.shareScriptTemplateSchema,
    [TEMPLATE_TYPE.SMS]: templatesSchema.shareMessageTemplateSchema,
    [TEMPLATE_TYPE.VIDEO]: templatesSchema.shareVideoTemplateSchema,
  };

  const t = await sequelize.transaction();

  try {
    const { type } = req.body;
    delete req.body.created_at;
    if (!Object.values(TEMPLATE_TYPE).includes(type)) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to share template',
        error: 'Provide a valid template type',
      });
    }

    const body = TEMPLATE_SHARE_SCHEMA[type].validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    const idString = TEMPLATE_ID_MAP[type];
    const templateId = req.body[idString];

    let fileName, newFileName, videoDuration;
    if (type == TEMPLATE_TYPE.VIDEO) {
      req.body.video_id = req.body.Video.video_id;
      videoDuration = req.body.Video.video_duration;
      fileName = req.body.Video.file_name;
      delete req.body.Video;
      delete req.body.Video_Trackings;
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to share template',
        error: `Error while fetching user: ${errForUser}`,
      });
    }

    const [ogTemplate, errForOgTemplate] = await Repository.fetchOne({
      tableName: TEMPLATE_TABLE_MAP[type],
      query: { [TEMPLATE_ID_MAP[type]]: templateId },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
        [DB_TABLES.SUB_DEPARTMENT]: {
          [DB_TABLES.DEPARTMENT]: { attributes: ['company_id'] },
          attributes: ['sd_id', 'department_id'],
        },
      },
    });
    if (errForOgTemplate) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to share template',
        error: `Error while fetching template table map: ${errForOgTemplate}`,
      });
    }
    if (!ogTemplate) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to share template',
        error: `No template found`,
      });
    }

    if (
      req.body.user_id === req.user.user_id &&
      req.body.level === TEMPLATE_LEVEL.PERSONAL &&
      ogTemplate.level === TEMPLATE_LEVEL.PERSONAL
    ) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You cannot share a template with yourself',
      });
    }

    let toShareUser,
      errToShareUser,
      toShareSubDepartment,
      errToShareSubDepartment;

    if (req.body.level === TEMPLATE_LEVEL.PERSONAL) {
      [toShareUser, errToShareUser] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: { user_id: req.body.user_id },
      });
      if (errToShareUser) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to share template',
          error: `Error while fetching user: ${errToShareUser}`,
        });
      }
      if (!toShareUser) {
        t.rollback();
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to share template',
          error: 'User does not exist',
        });
      }
    } else if (req.body.level === TEMPLATE_LEVEL.TEAM) {
      [toShareSubDepartment, errToShareSubDepartment] =
        await Repository.fetchOne({
          tableName: DB_TABLES.SUB_DEPARTMENT,
          query: { sd_id: req.body.sd_id },
          include: {
            [DB_TABLES.DEPARTMENT]: { [DB_TABLES.COMPANY]: {} },
          },
        });
      if (errToShareSubDepartment) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to share template',
          error: `Error while fetching sub department: ${errToShareSubDepartment}`,
        });
      }

      if (!toShareSubDepartment) {
        t.rollback();
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to share template',
          error: 'Sub department does not exist',
        });
      }
    }

    delete req.body[idString];

    const [access, errForAccess] = TemplateHelper.checkTemplateActionAccess({
      template: req.body,
      user,
      action: TEMPLATE_ACTIONS.SHARE,
      data: { ogTemplate, toShareUser, toShareSubDepartment },
    });
    if (errForAccess) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to share template',
        error: `Error while checking template action access: ${errForAccess}`,
      });
    }

    if (!access) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });
    }
    if (type == TEMPLATE_TYPE.VIDEO) {
      newFileName = nanoid();

      const [video, errForVideo] = await Repository.create({
        tableName: DB_TABLES.VIDEO,
        createObject: {
          file_name: newFileName,
          user_id: req.body.user_id,
          is_thumbnail_present: true,
          video_duration: videoDuration,
        },
      });
      if (errForVideo) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to share template',
          error: `Error while creating video: ${errForVideo}`,
        });
      }

      const [videoUrl, errForVideoUrl] = await Storage.Bucket.duplicateVideo(
        fileName,
        newFileName
      );
      if (errForVideoUrl) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to share template',
          error: `Error for duplicate video: ${errForVideoUrl}`,
        });
      }

      const [ThumbnailUrl, errForThumbnailUrl] =
        await Storage.Bucket.duplicateThumbnail(fileName, newFileName);
      if (errForThumbnailUrl) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to share template',
          error: `Error for duplicate thumbnail: ${errForThumbnailUrl}`,
        });
      }

      req.body.video_id = video.video_id;
    }

    if (type === TEMPLATE_TYPE.EMAIL) {
      req.body.redirectUrl = ogTemplate.redirectUrl;
      req.body.linkText = ogTemplate.linkText;
    }

    const [_template, _errForTemplate] = await Repository.create({
      tableName: TEMPLATE_TABLE_MAP[type],
      createObject: req.body,
    });
    if (_errForTemplate) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to share template',
        error: `Error while creating template table map: ${_errForTemplate}`,
      });
    }

    if (type === TEMPLATE_TYPE.EMAIL) {
      let [attachments, errForAttachments] =
        await AttachmentRepository.getAttachments({ et_id: ogTemplate.et_id });
      if (errForAttachments) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to share template',
          error: `Error while fetching attachments: ${errForAttachments}`,
        });
      }

      attachments = JsonHelper.parse(attachments);
      if (attachments?.length > 0) {
        const promiseArray = attachments.map((attachment) => {
          return AttachmentRepository.createAttachment({
            original_name: attachment.original_name,
            et_id: _template.et_id,
          });
        });
        await Promise.all(promiseArray);
      }
    }

    t.commit();
    return successResponse(res, 'Template was shared successfully', _template);
  } catch (err) {
    t.rollback();
    logger.error('Error while sharing the email template', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while sharing the email template: ${err.message}`,
    });
  }
};

const getShareUsers = async (req, res) => {
  try {
    const [user, errForUser] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users to share',
        error: `Error while fetching user by query: ${errForUser}`,
      });
    if (!user) return notFoundResponse(res, 'User not found.');

    let users = null,
      errForUsers = null;

    switch (user.role) {
      case USER_ROLE.SUPER_ADMIN:
      case USER_ROLE.ADMIN:
        // Fetch all users of the company
        [users, errForUsers] = await UserRepository.findUsersByQuery({
          company_id: user.company_id,
          role: [USER_ROLE.SALES_PERSON, USER_ROLE.SALES_MANAGER],
        });
        break;

      case USER_ROLE.SALES_MANAGER:
      case USER_ROLE.SALES_PERSON:
        // Fetch all users of the user's sub-dept

        {
          [users, errForUsers] = await UserRepository.findUsersByQuery({
            sd_id: user.sd_id,
            role: [USER_ROLE.SALES_PERSON, USER_ROLE.SALES_MANAGER],
          });
        }
        break;

      default:
        return forbiddenResponse(
          res,
          'You do not have permission to access this.'
        );
    }

    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users to share',
        error: `Error while fetching user by query: ${errForUsers}`,
      });

    return successResponse(res, 'Successfully fetched users.', users);
  } catch (err) {
    logger.error('Error while fetching users', err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching users to share: ${err.message}`,
    });
  }
};

const deleteTemplate = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { type } = req.query;

    if (!Object.values(TEMPLATE_TYPE).includes(type)) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to delete template',
        error: 'Provide a valid template type',
      });
    }

    const { templateId } = req.params;
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete template',
        error: `Error while fetching user: ${errForUser}`,
      });
    }

    const [template, errForTemplate] = await Repository.fetchOne({
      tableName: TEMPLATE_TABLE_MAP[type],
      query: { [TEMPLATE_ID_MAP[type]]: templateId },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
        [DB_TABLES.SUB_DEPARTMENT]: {
          [DB_TABLES.DEPARTMENT]: { attributes: ['company_id'] },
          attributes: ['sd_id', 'department_id'],
        },
      },
    });

    if (errForTemplate) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete template',
        error: `Error while fetching template table map: ${errForTemplate}`,
      });
    }
    if (!template) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: `${TEMPLATE_LABELS[type]} template not found`,
      });
    }

    const [access, errForAccess] = TemplateHelper.checkTemplateActionAccess({
      template,
      user,
      action: TEMPLATE_ACTIONS.DELETE,
    });
    if (errForAccess) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete template',
        error: `Error while checking template action access: ${errForAccess}`,
      });
    }

    if (!access) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });
    }
    if (type === TEMPLATE_TYPE.EMAIL) {
      const [attachments, errForAttachments] = await Repository.fetchAll({
        tableName: DB_TABLES.ATTACHMENT,
        query: { et_id: templateId },
        extras: {
          attributes: ['attachment_id'],
        },
      });
      if (errForAttachments) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete template',
          error: `Error while fetching attachments: ${errForAttachments}`,
        });
      }

      const attachmentIds = attachments.map(
        (attachment) => attachment?.attachment_id
      );

      if (attachmentIds?.length) {
        let [_, errForDeletedAttachments] =
          await AttachmentHelper.deleteAttachments({
            attachment_ids: attachmentIds,
          });
        if (errForDeletedAttachments)
          logger.error(
            `Error while deleting attachments: ${errForDeletedAttachments}`
          );
      }
    }
    if (type === TEMPLATE_TYPE.VIDEO) {
      const [updateVideoTracking, errForUpdateVideoTracking] =
        await Repository.update({
          tableName: DB_TABLES.VIDEO_TRACKING,
          updateObject: { vt_id: null },
          query: { vt_id: templateId },
        });
      if (errForUpdateVideoTracking) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete template',
          error: `Error while updating video tracking: ${errForUpdateVideoTracking}`,
        });
      }
    }

    const [deletedTemplate, err] = await Repository.destroy({
      tableName: TEMPLATE_TABLE_MAP[type],
      query: { [TEMPLATE_ID_MAP[type]]: templateId },
    });
    if (err) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete template',
        error: `Error while deleting template table map: ${err}`,
      });
    }

    t.commit();

    return successResponse(res, 'Template deleted succesfully');
  } catch (err) {
    t.rollback();
    logger.error(`Error while deleting template: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting template: ${err.message}`,
    });
  }
};

const updateTemplate = async (req, res) => {
  try {
    const { type } = req.body;
    if (!Object.values(TEMPLATE_TYPE).includes(type))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update template',
        error: 'Provide a valid template type',
      });

    const idString = TEMPLATE_ID_MAP[type];
    const templateId = req.body[idString];

    const TEMPLATE_UPDATE_SCHEMA = {
      [TEMPLATE_TYPE.EMAIL]: templatesSchema.updateEmailTemplateSchema,
      [TEMPLATE_TYPE.LINKEDIN]: templatesSchema.updateLinkedinTemplateSchema,
      [TEMPLATE_TYPE.WHATSAPP]: templatesSchema.updateWhatsappTemplateSchema,
      [TEMPLATE_TYPE.SMS]: templatesSchema.updateMessageTemplateSchema,
      [TEMPLATE_TYPE.SCRIPT]: templatesSchema.updateScriptTemplateSchema,
      [TEMPLATE_TYPE.VIDEO]: templatesSchema.updateVideoTemplateSchema,
    };
    const body = TEMPLATE_UPDATE_SCHEMA[type].validate(req.body);
    if (body.error) {
      if (body.error?.message?.toLowerCase()?.includes('total length allowed'))
        return unprocessableEntityResponseWithDevMsg({
          res,
          msg: body.error.message,
        });

      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });

    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update template',
        error: `Error while fetching user: ${errForUser}`,
      });

    const [ogTemplate, errForOgTemplate] = await Repository.fetchOne({
      tableName: TEMPLATE_TABLE_MAP[type],
      query: { [TEMPLATE_ID_MAP[type]]: templateId },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
      },
    });

    if (!ogTemplate)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update template',
        error: `No template found.`,
      });
    if (errForOgTemplate)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update template',
        error: `Error while fetching template table map: ${errForOgTemplate}`,
      });

    const [access, errForAccess] = TemplateHelper.checkTemplateActionAccess({
      template: ogTemplate,
      user,
      action: TEMPLATE_ACTIONS.UPDATE,
    });

    if (errForAccess)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update template',
        error: `Error while checking template action access: ${errForAccess}`,
      });
    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });

    const [updatedTemplate, err] = await Repository.update({
      tableName: TEMPLATE_TABLE_MAP[type],
      updateObject: req.body,
      query: { [TEMPLATE_ID_MAP[type]]: templateId },
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update template',
        error: `Error while updating template table map: ${err}`,
      });

    if (type === TEMPLATE_TYPE.EMAIL) {
      // Unlink attachments
      Repository.update({
        tableName: DB_TABLES.ATTACHMENT,
        query: {
          attachment_id: {
            [Op.notIn]: req?.body?.attachment_ids,
          },
          et_id: req.body?.et_id,
        },
        updateObject: {
          et_id: null,
        },
      });

      let attachment_ids = req.body?.attachment_ids;
      const [updatedAttachments, errForUpdatedAttachments] =
        await Repository.update({
          tableName: DB_TABLES.ATTACHMENT,
          query: {
            attachment_id: {
              [Op.in]: attachment_ids,
            },
          },
          updateObject: {
            et_id: req.body?.et_id,
          },
        });
    }

    return successResponse(
      res,
      `${TEMPLATE_LABELS[type]} template updated succesfully`,
      updatedTemplate
    );
  } catch (err) {
    logger.error(`Error while updating template: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating template: ${err.message}`,
    });
  }
};

// not in use
const getAllTemplatesCount = async (req, res) => {
  try {
    let totalTemplates = 0;
    // let promisesArray = Object.keys(TEMPLATE_TABLE_MAP).map((tableKey) => {
    //   return Repository.count({
    //     tableName: TEMPLATE_TABLE_MAP[tableKey],
    //   });
    // });

    // promisesArray.forEach(async (promise) => {
    //   const count = await promise;
    //   console.log(count);
    //   totalTemplates += count[0];
    // });

    const emailTemplates = await Repository.count({
      tableName: DB_TABLES.EMAIL_TEMPLATE,
      query,
      include,
    });
    const linkedinTemplates = await Repository.count({
      tableName: DB_TABLES.LINKEDIN_TEMPLATE,
      query,
      include,
    });
    const whatsappTemplates = await Repository.count({
      tableName: DB_TABLES.WHATSAPP_TEMPLATE,
      query,
      include,
    });
    const scriptTemplates = await Repository.count({
      tableName: DB_TABLES.SCRIPT_TEMPLATE,
      query,
      include,
    });

    const messageTemplates = await Repository.count({
      tableName: DB_TABLES.MESSAGE_TEMPLATE,
      query,
      include,
    });

    const videoTemplates = await Repository.count({
      tableName: DB_TABLES.VIDEO_TEMPLATE,
      query,
      include,
    });

    totalTemplates =
      emailTemplates[0] +
      linkedinTemplates[0] +
      whatsappTemplates[0] +
      scriptTemplates[0] +
      messageTemplates[0] +
      videoTemplates[0];

    return successResponse(res, 'Count received', totalTemplates);
  } catch (err) {
    logger.error(`Error while updating template: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching templates count: ${err.message}`,
    });
  }
};

const TemplateController = {
  createTemplate,
  getAllTemplates,
  getAllTemplatesForImport,
  duplicateTemplate,
  shareTemplate,
  getShareUsers,
  deleteTemplate,
  updateTemplate,
  getAllTemplatesCount,
  getLeadsForTemplate,
};

module.exports = TemplateController;

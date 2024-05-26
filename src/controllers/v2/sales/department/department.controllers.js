// Utils
const logger = require('../../../../utils/winston');
const {
  badRequestResponseWithDevMsg,
  successResponse,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');

const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

// Repository
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const {
  USER_ROLE,
  USER_INTEGRATION_TYPES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

// * Packages
const { Op } = require('sequelize');

const getAllEmployees = async (req, res) => {
  try {
    const { sd_id } = req.query;

    const [user, errForUser] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch employees',
        error: `Error while fetching users by query: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch employees',
        error: `No user found`,
      });

    let userQuery = {};

    // if sd_id is provided in query params,get employees for only that sd
    if (sd_id) userQuery = { sd_id };
    // else if user role is sales manager,get employees for only user sd
    else if (user.role === USER_ROLE.SALES_MANAGER)
      userQuery = { sd_id: user.sd_id };
    // else get for all sub-departments
    else userQuery = { department_id: user.department_id };

    const [users, errForUsers] =
      await UserRepository.getAllUsersWithSubDepartment(
        userQuery, // user query
        {}, // sd query
        [
          'user_id',
          'sd_id',
          'first_name',
          'last_name',
          'profile_picture',
          'is_profile_picture_present',
        ], // user attributes
        ['name'] // sd attributes
      );
    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch employees',
        error: `Error while fetching users with sub department: ${errForUsers}`,
      });

    return successResponse(
      res,
      `Users fetched successfully for ${
        sd_id ? 'sub_department' : 'department'
      }.`,
      users
    );
  } catch (err) {
    logger.error(`Error while fetching all employees for department: `, err);
    return serverErrorResponseWithDevMsg(
      res,
      `Error while fetching all employees for department: ${err.message}`
    );
  }
};

// * Get all users in company
const getAllCompanyUsers = async (req, res) => {
  try {
    // * Fetching all company users
    const [users, errFetchingCompanyUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: ['name'],
        },
      },
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
    if (errFetchingCompanyUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company users',
        error: `Error while fetching all company users: ${errFetchingCompanyUsers}`,
      });

    return successResponse(res, 'Successfully fetched users', users);
  } catch (err) {
    logger.error(`Error while fetching all company users: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching all company users: ${err.message}`,
    });
  }
};

const getEmployeesForTemplateFilters = async (req, res) => {
  try {
    const { sd_id } = req.query;

    const [user, errForUser] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch employees',
        error: `Error while fetching user by query: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch employees',
        error: `No user found`,
      });

    let userQuery = {};

    // if sd_id is provided in query params,get employees for only that sd
    if (sd_id) userQuery = { sd_id: sd_id === 'own' ? user.sd_id : sd_id };
    // else get for all sub-departments
    // else userQuery = { department_id: user.department_id };

    let users = [],
      errForUsers = null;

    if (sd_id) {
      [users, errForUsers] = await UserRepository.getAllUsersWithSubDepartment(
        userQuery, // user query
        {}, // sd query
        [
          'user_id',
          'sd_id',
          'first_name',
          'last_name',
          'profile_picture',
          'is_profile_picture_present',
        ], // user attributes
        ['name'] // sd attributes
      );
    }

    let query = {
      role: [USER_ROLE.ADMIN, USER_ROLE.SUPER_ADMIN],
      department_id: user.department_id,
    };

    if (!sd_id) {
      delete query.role;
    }

    const extras = {
      attributes: [
        'user_id',
        'sd_id',
        'first_name',
        'last_name',
        'profile_picture',
        'is_profile_picture_present',
      ],
    };
    const include = {
      [DB_TABLES.DEPARTMENT]: {
        required: true,
        attributes: ['name'],
      },
    };
    const [admins, errForAdmins] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query,
      include,
      extras,
    });

    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch employees',
        error: `Error while fetching users: ${errForUsers}`,
      });

    return successResponse(
      res,
      `Users fetched successfully for ${
        sd_id ? 'sub_department' : 'department'
      }.`,
      [...users, ...admins]
    );
  } catch (err) {
    logger.error(`Error while fetching all employees for department: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching all employees for department: ${err.message}`,
    });
  }
};

// * Search users
const searchUsers = async (req, res) => {
  try {
    let queryText = req.query.q;

    const [users, errFetchingUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: {
        [Op.or]: [
          sequelize.where(sequelize.fn('lower', sequelize.col('first_name')), {
            [Op.like]: `%${queryText ? queryText.toLowerCase() : ''}%`,
          }),
          sequelize.where(sequelize.fn('lower', sequelize.col('last_name')), {
            [Op.like]: `%${queryText ? queryText.toLowerCase() : ''}%`,
          }),
        ],
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: [
            'sd_id',
            'name',
            'profile_picture',
            'is_profile_picture_present',
          ],
        },
      },
      extras: {
        attributes: [
          'user_id',
          'first_name',
          'last_name',
          'email',
          'profile_picture',
          'is_profile_picture_present',
        ],
      },
    });
    if (errFetchingUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to search users',
        error: `Error while fetching users: ${errFetchingUsers}`,
      });

    return successResponse(res, 'Successfully fetched users', users);
  } catch (err) {
    logger.error(`An error occurred while search for users: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while searching users: ${err.message}`,
    });
  }
};

const DepartmentController = {
  getAllEmployees,
  getAllCompanyUsers,
  getEmployeesForTemplateFilters,
  searchUsers,
};

module.exports = DepartmentController;

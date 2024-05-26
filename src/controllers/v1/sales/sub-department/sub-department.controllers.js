// Utils
const logger = require('../../../../utils/winston');
const {
  createdSuccessResponse,
  successResponse,
  serverErrorResponse,
  badRequestResponse,
} = require('../../../../utils/response');
const {
  USER_ROLE,
  NODE_TYPES,
  USER_DELETE_OPTIONS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const { Op } = require('sequelize');
const fs = require('fs');

const TaskRepository = require('../../../../../../Cadence-Brain/src/repository/task.repository');
const SubDepartmentRepository = require('../../../../../../Cadence-Brain/src/repository/sub-department.repository');
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const LeadRepository = require('../../../../../../Cadence-Brain/src/repository/lead.repository');
const SubDepartmentSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/sub-department-settings.repository');
const CadenceRepository = require('../../../../../../Cadence-Brain/src/repository/cadence.repository');
const LeadToCadenceRepository = require('../../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');

// Helpers and services
const UserHelper = require('../../../../../../Cadence-Brain/src/helper/user');
const CadenceHelper = require('../../../../../../Cadence-Brain/src/helper/cadence');
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const Storage = require('../../../../../../Cadence-Brain/src/services/Google/Storage');

const createSubDepartment = async (req, res) => {
  try {
    // Pass name and department id in req body
    const [createSubDepartment, err] =
      await SubDepartmentRepository.createSubDepartment(req.body);
    if (err) return serverErrorResponse(res, err);

    let sub_department_settings = {
      sd_id: createSubDepartment.sd_id,
    };

    if (req.body.sub_department_settings)
      sub_department_settings = {
        ...req.body.sub_department_settings,
        sd_id: createSubDepartment.sd_id,
      };

    const [sdSettings, errForSdSettings] =
      await SubDepartmentSettingsRepository.createSubDepartmentSettings(
        sub_department_settings
      );
    if (errForSdSettings) return serverErrorResponse(res, errForSdSettings);

    return createdSuccessResponse(
      res,
      'Sub department created successfully.',
      createSubDepartment
    );
  } catch (err) {
    logger.error(`Error while creating sub department: ${err.message}`);
    return serverErrorResponse(res);
  }
};

const updateSubDepartment = async (req, res) => {
  try {
    // Pass name and department id in req body

    if (req.body.name === 'Admin')
      return badRequestResponse(res, `Cannot create a group with this name.`);

    const [updatedSubDepartment, err] =
      await SubDepartmentRepository.updateSubDepartment(
        req.params.id,
        req.body
      );
    if (err) return serverErrorResponse(res, err);

    // * we dont want to update sd_id
    delete req.body?.sub_department_settings?.sd_id;

    // * update sub_department_settings
    await SubDepartmentSettingsRepository.updateSubDepartmentSettingsByQuery(
      {
        sd_id: req.params.id,
      },
      req.body?.sub_department_settings || {}
    );

    return successResponse(
      res,
      'Sub department name updated successfully.',
      updatedSubDepartment
    );
  } catch (err) {
    logger.error(`Error while updating sub department: ${err.message}`);
    return serverErrorResponse(res);
  }
};

const fetchAllSubDepartments = async (req, res) => {
  try {
    const [user, userErr] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (userErr) return serverErrorResponse(res, 'Error while finding user');

    const [subDepartments, err] =
      await SubDepartmentRepository.getAllSubDepartmentsWithSalesPersonCount({
        department_id: user.department_id,
      });
    if (err) {
      if (err === 'Sub department not found.') {
        return serverErrorResponse(res, err);
      }
      return serverErrorResponse(res);
    }

    for (let sd of subDepartments) {
      let newSd = sd.dataValues;
      let userCount = newSd.Users.length;
      newSd.userCount = userCount;
      delete newSd.Users;
    }

    return successResponse(res, 'Fetched all sub-departments.', subDepartments);
  } catch (err) {
    logger.error(`Error while fetching all sub departments: ${err.message}`);
    return serverErrorResponse(res);
  }
};

const fetchAllSubDepartmentEmployeesByManager = async (req, res) => {
  try {
    const [employees, err] = await SubDepartmentRepository.getAllEmployees(
      req.user.user_id
    );
    if (err) {
      if (err === 'Sub department not found.') {
        return serverErrorResponse(res, err);
      }
      return serverErrorResponse(res);
    }

    return successResponse(res, 'Fetched all salespersons.', employees);
  } catch (err) {
    logger.error(
      `Error while fetching all sub department employees by manager: ${err.message}`
    );
    return serverErrorResponse(res);
  }
};

const fetchAllSubDepartmentEmployeesByAdmin = async (req, res) => {
  try {
    const { id: sd_id } = req.params;
    const [employees, err] = await SubDepartmentRepository.getEmployees(sd_id);
    if (err) {
      if (err === 'Sub department not found.') {
        return serverErrorResponse(res, err);
      }
      return serverErrorResponse(res);
    }

    const [subDepartment, errForSubDepartment] =
      await SubDepartmentRepository.getSubDepartment({ sd_id });
    if (err) return serverErrorResponse(res, err.message);

    let data = {
      subDepartment,
      employees,
    };

    return successResponse(res, 'Fetched sub department details.', data);
  } catch (err) {
    logger.error(
      `Error while fetching all sub department employees by admin: ${err.message}`
    );
    return serverErrorResponse(res);
  }
};

const fetchSubDepartment = async (req, res) => {
  try {
    const { sd_id } = req.params;
    const [sd, errForSd] = await SubDepartmentRepository.getSubDepartment({
      sd_id,
    });

    if (errForSd) return serverErrorResponse(res, errForSd);
    if (!sd) return badRequestResponse(res, 'Sub department not found.');

    return successResponse(res, 'Fetched sub department.', sd);
  } catch (err) {
    logger.error(`Error while fetching sub_department: ${err.message}.`);
    return serverErrorResponse(res, err.message);
  }
};

const changeProfilePicture = async (req, res) => {
  try {
    const buffer = fs.readFileSync(req.files.image.path);
    var [url, err] = await Storage.Bucket.uploadSubdepartmentProfilePicture(
      buffer,
      req.fields.sd_id
    );
    if (err) return serverErrorResponse(res, err);
    console.log('sd id: \n', req.fields.sd_id);
    var [data, err] = await SubDepartmentRepository.updateSubDepartment(
      req.fields.sd_id,
      {
        is_profile_picture_present: true,
      }
    );
    if (err) return serverErrorResponse(res, err.message);

    return successResponse(res, 'Profile picture updated successfully.', url);
  } catch (error) {
    logger.error(
      'error while changing sub department profile_picture',
      error.message
    );
    return serverErrorResponse(res, error.message);
  }
};

const fetchSubDepartmentUsersWithCompletedTasksCount = async (req, res) => {
  try {
    // Fetch manager info
    let [manager, errForManager] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForManager) return serverErrorResponse(res, errForManager);

    // Get manager timezone 12am in unix timestamp
    const currentStartTime = new Date().getTime();
    const managerStartTime = UserHelper.setHoursForTimezone(
      0,
      currentStartTime,
      manager?.timezone
    );

    let [users, errForUsers] =
      await UserRepository.getAllSubDepartmentUsersWithTaskCount(
        manager.sd_id,
        managerStartTime
      );

    if (errForUsers)
      return serverErrorResponse(
        res,
        `Error while fetching users with completed tasks count: ${errForUsers}`
      );
    users = users.filter((n) => n.user_id !== null);
    if (users.length === 0)
      return successResponse(res, 'No users present in this sub department');

    return successResponse(
      res,
      'Fetched all salespersons with completed tasks.',
      users
    );

    /*
    // get users of that sd_id
    let [users, err2] = await UserRepository.findUsersByQuery({
      sd_id: manager.sd_id,
      // role is sales_person or sales_manager_person
      role: {
        [Op.in]: [USER_ROLE.SALES_PERSON, USER_ROLE.SALES_MANAGER_PERSON],
      },
    });
    if (err2) return serverErrorResponse(res, err2);
    // push task count of each user to a promises array, then await all promises
    let promises = [];
    users.forEach((user) => {
      let query = {
        user_id: user.user_id,
        // start time in last 24 hours
        // check if logic needs optimization <>
        start_time: {
          [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      };
      promises.push(TaskRepository.countTasks({ ...query, completed: 1 })); // completed tasks
      promises.push(TaskRepository.countTasks(query)); // all tasks
    });

    // add task counts to users
    let resolvedPromises = await Promise.all(promises);
    for (let i = 0; i < resolvedPromises.length; i += 2) {
      users[i / 2].completed_tasks = resolvedPromises[i][0];
      users[i / 2].total_tasks = resolvedPromises[i + 1][0];
    }
    */
  } catch (err) {
    logger.error(
      `Error while fetching sub_department employees task by manager: ${err.message}.`
    );
    return serverErrorResponse(res);
  }
};

const fetchTasksOfAnyUser = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { status } = req.query;
    if (status === 'in_progress') {
      const [tasks, err] = await TaskHelper.getPendingTasks(user_id, '', '');
      if (err) return serverErrorResponse(res);
      if (tasks.length === 0)
        return successResponse(res, 'User does not have any pending tasks.');

      return successResponse(res, 'Fetched all pending tasks.', tasks);
    } else {
      // Fetch manager info
      let [user, errForUser] = await UserRepository.findUserByQuery({
        user_id,
      });
      if (errForUser) return serverErrorResponse(res, errForUser);

      // Get user timezone 12am in unix timestamp
      const currentStartTime = new Date().getTime();
      const userStartTime = UserHelper.setHoursForTimezone(
        0,
        currentStartTime,
        user?.timezone
      );
      const [tasks, err] = await TaskRepository.getTasksByQuery(
        {
          completed: 1,
          complete_time: {
            [Op.gte]: userStartTime,
          },
          user_id,
        },
        {
          type: {
            [Op.notIn]: [
              NODE_TYPES.AUTOMATED_MAIL,
              NODE_TYPES.AUTOMATED_MESSAGE,
            ],
          },
        }
      );
      if (err) return serverErrorResponse(res);
      if (tasks.length === 0)
        return successResponse(res, 'User does not have any completed tasks.');

      return successResponse(res, 'Fetched all completed tasks.', tasks);
    }
  } catch (err) {
    logger.error(
      `Error while fetching employee tasks by manager: ${err.message}.`
    );
    return serverErrorResponse(res);
  }
};

const deleteSubDepartment = async (req, res) => {
  try {
    const {
      source_sd_id,
      userDeleteAction,
      leadDeleteAction,
      cadenceDeleteAction,
      dest_sd_id,
    } = req.body;

    if (
      !source_sd_id ||
      userDeleteAction === null ||
      leadDeleteAction === null ||
      cadenceDeleteAction === null
    )
      return badRequestResponse(res);
    let [users, errForUsers] = await UserRepository.findUsersByQuery({
      sd_id: source_sd_id,
    });
    if (errForUsers)
      return serverErrorResponse(
        res,
        `Error while fetching users to delete: ${errForUsers}`
      );

    //handle users and leads:
    if (userDeleteAction) {
      //delete all users:
      if (leadDeleteAction)
        await Promise.all(
          users.flatMap(async (user) => {
            const [leads, errForLead] = await LeadRepository.getLeadsByQuery({
              user_id: user.user_id,
            });
            if (
              errForLead ||
              user.role === USER_ROLE.SALES_MANAGER ||
              user.role === USER_ROLE.SALES_MANAGER_PERSON
            )
              return [
                new Promise((resolve, reject) => {
                  resolve();
                }),
              ];
            return [
              UserHelper.deleteAllUserInfo(user.user_id),
              UserHelper.handleUserDelete(
                LeadToCadenceRepository,
                user.user_id,
                null,
                USER_DELETE_OPTIONS.DELETE_ALL
              ),
            ];
          })
        );
      else
        await Promise.all(
          users.flatMap(async (user) => {
            const [leads, errForLead] = await LeadRepository.getLeadsByQuery({
              user_id: user.user_id,
            });
            if (
              errForLead ||
              user.role === USER_ROLE.SALES_MANAGER ||
              user.role === USER_ROLE.SALES_MANAGER_PERSON
            )
              return [
                new Promise((resolve, reject) => {
                  resolve();
                }),
              ];
            return [
              UserHelper.deleteAllUserInfo(user.user_id),
              UserHelper.handleUserDelete(
                LeadRepository,
                user.user_id,
                null,
                USER_DELETE_OPTIONS.UNASSIGN
              ),
            ];
          })
        );
    } else {
      if (!dest_sd_id)
        return badRequestResponse(
          res,
          'Destination Sub Department Id not provided'
        );
      if (leadDeleteAction) {
        await Promise.all(
          users.flatMap(async (user) => {
            const [leads, errForLead] = await LeadRepository.getLeadsByQuery({
              user_id: user.user_id,
            });
            if (errForLead)
              return [
                new Promise((resolve, reject) => {
                  resolve();
                }),
              ];

            return [
              UserRepository.updateUserById(
                { sd_id: dest_sd_id, role: USER_ROLE.SALES_PERSON },
                user.user_id
              ),
              UserHelper.handleUserDelete(
                leads,
                user.user_id,
                null,
                USER_DELETE_OPTIONS.DELETE_ALL
              ),
            ];
          })
        );
      } else
        await Promise.all(
          users.flatMap(async (user) => {
            const [leads, errForLead] = await LeadRepository.getLeadsByQuery({
              user_id: user.user_id,
            });
            if (errForLead)
              return [
                new Promise((resolve, reject) => {
                  resolve();
                }),
              ];
            return [
              UserRepository.updateUserById(
                { sd_id: dest_sd_id, role: USER_ROLE.SALES_PERSON },
                user.user_id
              ),
              UserHelper.handleUserDelete(
                leads,
                user.user_id,
                null,
                USER_DELETE_OPTIONS.UNASSIGN
              ),
            ];
          })
        );
    }
    //handle cadences:

    if (cadenceDeleteAction) {
      const [cadences, errForCadences] = await CadenceRepository.getCadences(
        { sd_id: source_sd_id },
        false
      );
      if (errForCadences)
        return serverErrorResponse(
          res,
          `Error while fetching cadences to delete: ${errForCadences}`
        );

      await Promise.all(
        cadences.map((cadence) => {
          return CadenceHelper.handleCadenceDelete(cadence.cadence_id);
        })
      );
    } else {
      const [updateCadences, errForUpdateCadences] =
        await CadenceRepository.updateCadence(
          { sd_id: source_sd_id },
          { sd_id: dest_sd_id }
        );
      if (errForUpdateCadences)
        return serverErrorResponse(
          res,
          `Error while updating cadences: ${errForUpdateCadences}`
        );
    }

    //delete Sub Department:
    const [deleteSubDepartment, errForDeleteSubDepartment] =
      await SubDepartmentRepository.deleteSubDepartment(source_sd_id);
    if (errForDeleteSubDepartment)
      return serverErrorResponse(
        res,
        `Error while deleting sub department: ${errForDeleteSubDepartment}`
      );
    const [deleteSubDepartmentSettings, errForDeleteSubDepartmentSettings] =
      await SubDepartmentSettingsRepository.deleteSubDepartmentSettingsByQuery({
        sd_id: source_sd_id,
      });
    if (errForDeleteSubDepartmentSettings)
      return serverErrorResponse(
        res,
        `Error while deleting sub department settings: ${errForDeleteSubDepartmentSettings}`
      );

    return successResponse(res, 'Sub Department deleted successfully');
  } catch (err) {
    logger.error(`Error while deleting sub department: ${err.message}`);
    return serverErrorResponse(res);
  }
};

const SubDepartmentController = {
  createSubDepartment,
  updateSubDepartment,
  fetchAllSubDepartments,
  fetchAllSubDepartmentEmployeesByManager,
  fetchAllSubDepartmentEmployeesByAdmin,
  fetchSubDepartment,
  changeProfilePicture,
  fetchSubDepartmentUsersWithCompletedTasksCount,
  fetchTasksOfAnyUser,
  deleteSubDepartment,
};

module.exports = SubDepartmentController;

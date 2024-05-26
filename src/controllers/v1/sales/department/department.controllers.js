// Utils
const logger = require('../../../../utils/winston');
const {
  createdSuccessResponse,
  successResponse,
  serverErrorResponse,
} = require('../../../../utils/response');

// Repositories
const DepartmentRepository = require('../../../../../../Cadence-Brain/src/repository/department.repository');

const createDepartment = async (req, res) => {
  try {
    // Pass name and company id id in req body
    const [createdDepartment, err] =
      await DepartmentRepository.createDepartment(req.body);
    if (err) {
      logger.error('Error creating department: ', err);
      return serverErrorResponse(res);
    }
    return createdSuccessResponse(
      res,
      'Department created successfully.',
      createdDepartment
    );
  } catch (err) {
    logger.error(`Error while creating department: `, err);
    return serverErrorResponse(res);
  }
};

// const fetchAllDepartmentEmployees = async (req, res) => {
//   try {
//     const [employees, err] = await DepartmentRepository.getAllEmployees(
//       req.user.user_id
//     );
//     if (err) {
//       if (err === 'Department not found.') {
//         return serverErrorResponse(res, err);
//       }
//       return serverErrorResponse(res);
//     }
//     logger.info(JSON.stringify(employees, null, 2));
//     return successResponse(res, 'Fetched all salesPersons.', employees);
//   } catch (err) {
//     logger.error(err.message);
//     return serverErrorResponse(res);
//   }
// };

const DepartmentController = {
  createDepartment,
  // fetchAllDepartmentEmployees,
};

module.exports = DepartmentController;

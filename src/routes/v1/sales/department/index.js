// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const departmentController = require('../../../../controllers/v1/sales/department/department.controllers');

// Route imports
const cadenceRoutes = require('./cadence.routes');
const nodeRoutes = require('./node.routes');
const taskRoutes = require('./task.routes');

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.DEPARTMENT
    ),
  ],
  departmentController.createDepartment
);

// TO_DELETE
// router.get(
//   '/employees',
//   [
//     auth,
//     AccessControlMiddleware.checkAccess(
//       RBAC_ACTIONS.READ_OWN,
//       RBAC_RESOURCES.USER
//     ),
//   ],
//   departmentController.fetchAllDepartmentEmployees
// );

router.use('/cadence', cadenceRoutes);
router.use('/node', nodeRoutes);
router.use('/task', taskRoutes);

module.exports = router;

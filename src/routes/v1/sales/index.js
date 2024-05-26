// Packages
const express = require('express');
const app = express();

// Route imports
const departmentRoutes = require('./department');
const subDepartmentRoutes = require('./sub-department');
const employeeRoutes = require('./employee');
const leadRoutes = require('./lead');
const attachmentRoutes = require('./attachments');
const salesforceIntegrationRoutes = require('./salesforce-integrations');

// Routes
app.use('/department', departmentRoutes);
app.use('/sub-department', subDepartmentRoutes);
app.use('/employee', employeeRoutes);
app.use('/lead', leadRoutes);
app.use('/attachments', attachmentRoutes);
app.use('/salesforce/integration', salesforceIntegrationRoutes);

module.exports = app;

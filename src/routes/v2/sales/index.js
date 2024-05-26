// Package imports
const express = require('express');
const app = express();

// Route imports
const departmentRoutes = require('./department');
const leadRoutes = require('./lead');
const subDepartmentRoutes = require('./sub-department');
const employeeRoutes = require('./employee');
const homepageRoutes = require('./home-page');
const attachmentRoutes = require('./attachment');

// Routes
app.use('/department', departmentRoutes);
app.use('/lead', leadRoutes);
app.use('/sub-department', subDepartmentRoutes);
app.use('/employee', employeeRoutes);
app.use('/home-page', homepageRoutes);
app.use('/attachments', attachmentRoutes);

module.exports = app;

// Package imports
const express = require('express');
const app = express();

// Route imports
const adminRoutes = require('./admin');
const salesRoutes = require('./sales');
const userRoutes = require('./user');
const companyRoutes = require('./company');
const externalRoutes = require('./external');
const linkedinRoutes = require('./linkedin');
const chatbotRoutes = require('./chatbot');
const oauthRoutes = require('./oauth');
const webhookRoutes = require('./webhooks');
const outlookRoutes = require('./outlook');
const extensionRoutes = require('./extension');
const googleRoutes = require('./google');
const excelRoutes = require('./excel');
const zapierRoutes = require('./zapier');
const bugReportRoutes = require('./bug-reports');
const supportRoutes = require('./support');
const aiRoutes = require('./ai');

// Routes
app.use('/admin', adminRoutes);
app.use('/sales', salesRoutes);
app.use('/user', userRoutes);
app.use('/company', companyRoutes);
app.use('/external', externalRoutes);
app.use('/linkedin', linkedinRoutes);
app.use('/oauth', oauthRoutes);
app.use('/chatbot', chatbotRoutes);
app.use('/webhook', webhookRoutes);
app.use('/outlook', outlookRoutes);
app.use('/extension', extensionRoutes);
app.use('/google', googleRoutes);
app.use('/excel', excelRoutes);
app.use('/zapier', zapierRoutes);
app.use('/bug-report', bugReportRoutes);
app.use('/support', supportRoutes);
app.use('/ai', aiRoutes);

module.exports = app;

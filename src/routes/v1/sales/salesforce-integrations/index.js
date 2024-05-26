// Packages
const express = require('express');
const app = express();

// Route imports
const leadRoutes = require('./lead.routes');
const contactRoutes = require('./contact.routes');
const accountRoutes = require('./account.routes');
const cadenceRoutes = require('./cadence.routes');
const internalRoutes = require('./internal.routes');
const opportunityRoutes = require('./opportunity.routes');

// Routes
app.use('/lead', leadRoutes);
app.use('/contact', contactRoutes);
app.use('/account', accountRoutes);
app.use('/cadence', cadenceRoutes);
app.use('/internal', internalRoutes);
app.use('/opportunity', opportunityRoutes);

module.exports = app;

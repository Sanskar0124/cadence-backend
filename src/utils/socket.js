// Utils
const logger = require('./winston');

// Packages
const { nanoid } = require('nanoid');

// Repositories
const LeadRepository = require('../../../Cadence-Brain/src/repository/lead.repository');
const UserRepository = require('../../../Cadence-Brain/src/repository/user-repository');
const TaskHelper = require('../../../Cadence-Brain/src/helper/task');

const sendNotification = async ({
  type,
  user_id,
  lead_id,
  title,
  message_id = false,
  withTime = false,
}) => {
  try {
    let time = '';
    if (withTime) {
      time = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }); // if time is needed like at 08:14
    }
    const [user] = await UserRepository.findUserByQuery({ user_id });
    if (user == null) return;

    let [lead] = await LeadRepository.getLeadByQuery({ lead_id });
    if (lead == null) {
      lead = {
        first_name: '',
        last_name: '',
      };
    }

    let desc = `${lead.first_name} ${lead.last_name} ${time}`;
    console.log(desc);
    const notification = {
      type,
      title,
      caption: desc,
      message_id: message_id,
      lead_id,
      id: nanoid(),
    };
    global.io.to(user.email).emit('notification', notification);
    logger.info('Notification sent:- ' + JSON.stringify(notification, null, 4));
    return ['Notification sent:- ' + notification, null];
  } catch (err) {
    logger.error(`Error while sending notification by socket: ${err.message}`);
    return [null, err];
  }
};

const sendActivity = async ({ activity, user_id, email }) => {
  try {
    let userQuery = {};

    if (user_id) userQuery = { user_id };
    else userQuery = { email };

    let [user, _] = await UserRepository.findUserByQuery(userQuery);

    global.io.to(email ? email : user.email).emit('activity', activity);

    // fetch task summary
    const [taskSummary, errForTaskSummary] =
      await TaskHelper.findOrCreateTaskSummary({
        user_id: user.user_id,
        toUpdateInRedis: true,
        activity,
      });

    // if found, send
    if (taskSummary)
      global.io
        .to(email ? email : user.email)
        .emit('task-summary', taskSummary);

    console.log(
      'Activity sent to ' + (email ? email : user.email) + ' by socket'
    );
    return [
      `Activity sent to ' ${email ? email : user.email}  ' by socket`,
      null,
    ];
  } catch (err) {
    logger.error(`Error while sending activity through socket: ${err.message}`);
    return [null, err];
  }
};

const sendMessage = async ({ user_id, email, message }) => {
  try {
    let user;
    if (!email) {
      [user, _] = await UserRepository.findUserByQuery({ user_id });
    }
    global.io.to(email ? email : user.email).emit('new-message', message);
  } catch (e) {
    logger.error(err.message);
    return [null, err];
  }
};

const refreshAgenda = async ({ user_id }) => {
  try {
    let [user, _] = await UserRepository.findUserByQuery({ user_id });
    global.io.to(user.email).emit('refresh-agenda', '');
    logger.info('Successfully sent refresh-agenda event');
  } catch (e) {
    logger.error(err.message);
    return [null, err];
  }
};

const deleteTask = (user, task_id) => {
  try {
    global.io.to(user.email).emit('delete-task', { task_id });
    logger.info(`Successfully sent delete task event to ${user.email}.`);
  } catch (e) {
    logger.error(err.message);
    return [null, err.message];
  }
};

const updateLeaderboard = (user, task) => {
  try {
    global.io.to(user.company_id).emit('update-leaderboard', { task });
    global.io.to(user.sd_id).emit('update-leaderboard', { task });
    logger.info(
      `Successfully sent update leaderboard event to ${user.company_id}.`
    );
  } catch (e) {
    logger.error(err.message);
    return [null, err.message];
  }
};

const updateCompletedTasks = async ({ email, user_id, taskCount }) => {
  try {
    let user = '';

    [user, _] = await UserRepository.findUserByQuery({ user_id });

    // fetch task summary
    const [taskSummary, errForTaskSummary] =
      await TaskHelper.findOrCreateTaskSummary({
        user_id: user.user_id,
        toUpdateInRedis: true,
        taskIncrementCount: taskCount,
      });

    // if found, send
    if (taskSummary)
      global.io
        .to(email ? email : user.email)
        .emit('task-summary', taskSummary);

    console.log(
      'Completed task count sent to ' +
        (email ? email : user.email) +
        ' by socket'
    );
    return [
      `Completed task count sent to ' ${
        email ? email : user.email
      }  ' by socket`,
      null,
    ];
  } catch (err) {
    logger.error(`Error while updating completed tasks socket: `, err);
    return [null, err.message];
  }
};

const SocketHelper = {
  sendNotification,
  sendActivity,
  sendMessage,
  refreshAgenda,
  deleteTask,
  updateLeaderboard,
  updateCompletedTasks,
};

module.exports = SocketHelper;

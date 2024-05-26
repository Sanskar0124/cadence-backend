/**
 *
 * @param {Array} result This should be an sorted array of users and sort field should be 'user.tasks.noOfTasksDone'
 * @returns Same array with rank assigned
 */
const assignRank = (result) => {
  let maxTasks = result[0];
  let currRank = 1;
  for (let index = 0; index < result.length; index++) {
    const element = result[index];

    if (index === 0) {
      maxTasks = element.tasks.noOfTasksDone;
      element.rank = currRank;
    }

    if (element.tasks.noOfTasksDone === maxTasks) {
      element.rank = currRank;
    } else {
      element.rank = currRank + 1;
      currRank += 1;
      maxTasks = element.tasks.noOfTasksDone;
    }
  }

  return result;
};

module.exports = assignRank;

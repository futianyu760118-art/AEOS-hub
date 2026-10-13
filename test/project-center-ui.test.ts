import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCollaborationTasks, projectDisplayState, taskBoardColumns } from '../public/task-center.js';

const project = { projectId: 'project-01', ownerActorId: 'm01:user:manager-01', status: 'IN_PROGRESS' };
const tasks = [
  { taskId: 'task-01', projectId: 'project-01', title: '完成供应确认', status: 'COMPLETED', currentAssignee: { actorId: 'm01:user:operator-01' } },
  { taskId: 'task-02', projectId: 'project-01', title: '核对交付时限', status: 'IN_PROGRESS', currentAssignee: { actorId: 'm01:user:operator-02' } },
  { taskId: 'task-03', projectId: null, title: '独立事项', status: 'DRAFT', currentAssignee: null },
];

test('derives project progress from project tasks and handles an empty project', () => {
  assert.deepEqual(projectDisplayState(project, tasks).progress, { total: 2, completed: 1, percent: 50 });
  assert.deepEqual(projectDisplayState({ ...project, projectId: 'project-empty' }, tasks).progress, { total: 0, completed: 0, percent: 0 });
});

test('filters collaboration tasks without including another project', () => {
  assert.deepEqual(filterCollaborationTasks(tasks, { projectId: 'project-01', query: '交付' }).map((task) => task.taskId), ['task-02']);
  assert.deepEqual(filterCollaborationTasks(tasks, { status: 'COMPLETED' }).map((task) => task.taskId), ['task-01']);
  assert.equal(taskBoardColumns(tasks).find((column) => column.status === 'IN_PROGRESS')?.tasks.length, 1);
});

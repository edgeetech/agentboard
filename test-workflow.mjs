#!/usr/bin/env node
/**
 * Automated test for Copilot CLI agent support.
 * Validates: create task with PM → PM completes → Worker spawns → Human Approval
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const configPath = join(homedir(), '.agentboard', 'config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const BASE_URL = `http://127.0.0.1:${config.port}`;
const BEARER_TOKEN = config.token;

function request(method, path, body = null, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = {
      'Content-Type': contentType,
      'Host': `127.0.0.1:${config.port}`,
      'Authorization': `Bearer ${BEARER_TOKEN}`,
    };

    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, body: parsed, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, body: null, raw: data, parseError: e.message });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function log(color, ...args) {
  const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
  };
  console.log(colors[color] || '', ...args, colors.reset || '');
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForCondition(condition, maxWaitMs = 60000, intervalMs = 2000, label = '') {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const result = await condition();
    if (result) {
      log('green', `✅ ${label}: condition met`);
      return result;
    }
    await sleep(intervalMs);
  }
  log('red', `❌ ${label}: timeout after ${maxWaitMs}ms`);
  return null;
}

async function main() {
  log('blue', '🚀 Starting AgentBoard Workflow Test');

  // Step 1: Get project info
  log('blue', '\n[Step 1] Getting active project...');
  let project;
  const projRes = await request('GET', '/api/projects/active');
  if (projRes.status !== 200 || !projRes.body || !projRes.body.project) {
    log('red', `❌ Failed to get active project (status ${projRes.status})`);
    // Try to create a project first
    log('blue', '\n[Creating default project...]');
    const createProjRes = await request('POST', '/api/projects', {
      code: 'TEST',
      name: 'Test Project',
      description: 'Automated test project',
      workflow_type: 'WF2',
      repo_path: process.cwd(),
      agent_provider: 'claude',
    });
    if (createProjRes.status !== 201) {
      log('red', `❌ Failed to create project: ${JSON.stringify(createProjRes.body)}`);
      return;
    }
    log('green', `✅ Created project: ${createProjRes.body.project.code}`);
    const projRes2 = await request('GET', '/api/projects/active');
    if (projRes2.status !== 200 || !projRes2.body || !projRes2.body.project) {
      log('red', `❌ Still no active project`);
      return;
    }
    project = projRes2.body.project;
  } else {
    project = projRes.body.project;
  }
  const projectId = project.id;
  log('green', `✅ Project: ${project.code} (provider: ${project.agent_provider || 'claude'})`);

  // Step 2: Create task with PM assignee
  log('blue', '\n[Step 2] Creating task with PM assignee...');
  const taskTitle = `Test-Task-${randomUUID().substring(0, 8)}`;
  const createRes = await request('POST', '/api/tasks', {
    title: taskTitle,
    description: 'Automated test for PM → Worker workflow',
    assignee_role: 'pm',
  });

  if (createRes.status !== 201 || !createRes.body || !createRes.body.task) {
    log('red', `❌ Failed to create task (status ${createRes.status}):`, createRes.raw);
    return;
  }

  const task = createRes.body.task;
  const taskId = task.id;
  const taskCode = task.code;
  log('green', `✅ Created task: ${taskCode} (id: ${taskId})`);
  log('green', `   Status: ${task.status}, Assignee: ${task.assignee_role}`);

  // Step 3: Check if run was enqueued
  log('blue', '\n[Step 3] Waiting for PM agent to spawn...');
  const pmRun = await waitForCondition(
    async () => {
      const res = await request('GET', `/api/tasks/${taskId}`);
      if (res.status !== 200 || !res.body) return null;
      const t = res.body.task;
      if (t.has_active_run) {
        log('green', `   PM agent enqueued/running`);
        return t;
      }
      return null;
    },
    30000,
    2000,
    'PM agent enqueue'
  );

  if (!pmRun) {
    log('red', '❌ PM agent was not spawned');
    return;
  }

  // Step 4: Wait for PM agent to complete
  log('blue', '\n[Step 4] Waiting for PM agent to complete (this may take a while)...');
  const pmCompleted = await waitForCondition(
    async () => {
      const res = await request('GET', `/api/tasks/${taskId}`);
      if (res.status !== 200 || !res.body) return null;
      const t = res.body.task;
      // PM completes when:
      // - No active run
      // - Status might be 'todo' (unchanged) or transitioned
      // - AC should have been added
      if (!t.has_active_run) {
        log('green', `   PM agent completed`);
        log('green', `   Status: ${t.status}, Assignee: ${t.assignee_role}`);
        return t;
      }
      process.stdout.write('.');
      return null;
    },
    90000, // 90 sec for PM
    3000,
    'PM completion'
  );

  if (!pmCompleted) {
    log('red', '❌ PM agent did not complete in time');
    return;
  }

  // Step 5: Verify PM added acceptance criteria
  log('blue', '\n[Step 5] Verifying PM added acceptance criteria...');
  if (pmCompleted.acceptance_criteria_json) {
    try {
      const acs = JSON.parse(pmCompleted.acceptance_criteria_json);
      if (Array.isArray(acs) && acs.length > 0) {
        log('green', `✅ AC added by PM: ${acs.length} criteria`);
        acs.slice(0, 3).forEach((ac, i) => {
          log('green', `   [${i + 1}] ${ac.substring(0, 60)}...`);
        });
      } else {
        log('yellow', `⚠️  PM did not add acceptance criteria (empty or not an array)`);
      }
    } catch (e) {
      log('yellow', `⚠️  Could not parse AC JSON: ${e.message}`);
    }
  } else {
    log('yellow', `⚠️  PM did not add acceptance criteria`);
  }

  // Step 6: Wait for Worker agent to spawn
  log('blue', '\n[Step 6] Waiting for Worker agent to spawn...');
  const workerSpawned = await waitForCondition(
    async () => {
      const res = await request('GET', `/api/tasks/${taskId}`);
      if (res.status !== 200 || !res.body) return null;
      const t = res.body.task;
      if (t.assignee_role === 'worker' && t.status === 'agent_working') {
        log('green', `   Worker agent spawned`);
        return t;
      }
      return null;
    },
    30000,
    2000,
    'Worker spawn'
  );

  if (!workerSpawned) {
    log('yellow', `⚠️  Worker agent was not spawned (task may not have transitioned)`);
    // Check current state
    const res = await request('GET', `/api/tasks/${taskId}`);
    if (res.status === 200 && res.body) {
      const t = res.body.task;
      log('yellow', `   Current status: ${t.status}, assignee: ${t.assignee_role}, active_run: ${t.has_active_run}`);
    }
  } else {
    // Step 7: Wait for Worker to complete
    log('blue', '\n[Step 7] Waiting for Worker agent to complete...');
    const workerCompleted = await waitForCondition(
      async () => {
        const res = await request('GET', `/api/tasks/${taskId}`);
        if (res.status !== 200 || !res.body) return null;
        const t = res.body.task;
        if (!t.has_active_run) {
          log('green', `   Worker agent completed`);
          log('green', `   Status: ${t.status}, Assignee: ${t.assignee_role}`);
          return t;
        }
        process.stdout.write('.');
        return null;
      },
      120000, // 120 sec for Worker
      3000,
      'Worker completion'
    );

    if (!workerCompleted) {
      log('red', '❌ Worker agent did not complete in time');
    } else {
      // Step 8: Verify final state
      log('blue', '\n[Step 8] Verifying final state...');
      if (workerCompleted.status === 'human_approval') {
        log('green', `✅ Task reached human approval (status: ${workerCompleted.status})`);
        if (workerCompleted.assignee_role === 'human') {
          log('green', `✅ Task assigned to human for approval`);
          log('green', `\n🎉 WORKFLOW COMPLETE: PM → Worker → Human Approval`);
        } else {
          log('yellow', `⚠️  Task status is human_approval but assignee is ${workerCompleted.assignee_role}`);
        }
      } else {
        log('yellow', `⚠️  Final status is ${workerCompleted.status} (expected: human_approval)`);
      }
    }
  }

  // Final summary
  log('blue', '\n[Summary] Task history:');
  const histRes = await request('GET', `/api/tasks/${taskId}/history`);
  if (histRes.status === 200 && histRes.body && histRes.body.history) {
    histRes.body.history.forEach((h, i) => {
      log('blue', `  [${i + 1}] ${h.from_status} → ${h.to_status} (by: ${h.by_role})`);
    });
  }

  log('blue', '\n✅ Test completed');
}

main().catch(e => {
  log('red', '❌ Test failed with error:', e.message);
  process.exit(1);
});

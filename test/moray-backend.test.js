// Copyright (c) 2012, Joyent, Inc. All rights reserved.
var test = require('tap').test,
    uuid = require('node-uuid'),
    SOCKET = '/tmp/.' + uuid(),
    util = require('util'),
    async = require('async'),
    Factory = require('wf').Factory,
    WorkflowMorayBackend = require('../lib/workflow-moray-backend');

var backend, factory;

var aWorkflow, aJob, anotherJob;

var helper = require('./helper'),
    config = helper.config(),
    runnerId = config.runner.identifier;

test('setup', function (t) {
  console.time('Moray Backend');
  backend = new WorkflowMorayBackend(config.backend.opts);
  t.ok(backend, 'backend ok');
  backend.init(function () {
    t.ok(backend.client, 'backend client ok');
    factory = Factory(backend);
    t.ok(factory, 'factory ok');
    t.end();
  });
});


test('add a workflow', function (t) {
  factory.workflow({
    name: 'A workflow',
    chain: [ {
      name: 'A Task',
      timeout: 30,
      retry: 3,
      body: function (job, cb) {
        return cb(null);
      }
    }],
    timeout: 180,
    onError: [ {
      name: 'Fallback task',
      body: function (job, cb) {
        return cb('Workflow error');
      }
    }]
  }, function (err, workflow) {
    t.ifError(err, 'add workflow error');
    t.ok(workflow, 'add workflow ok');
    aWorkflow = workflow;
    t.ok(workflow.chain[0].uuid, 'add workflow chain task');
    t.ok(workflow.onerror[0].uuid, 'add workflow onerror task');
    t.end();
  });
});


test('workflow name must be unique', function (t) {
  factory.workflow({
    name: 'A workflow',
    chain: [ {
      name: 'A Task',
      timeout: 30,
      retry: 3,
      body: function (job, cb) {
        return cb(null);
      }
    }],
    timeout: 180,
    onError: [ {
      name: 'Fallback task',
      body: function (job, cb) {
        return cb('Workflow error');
      }
    }]
  }, function (err, workflow) {
    t.ok(err, 'duplicated workflow name err');
    t.end();
  });
});


test('get workflow', function (t) {
  backend.getWorkflow(aWorkflow.uuid, function (err, workflow) {
    t.ifError(err, 'get workflow error');
    t.ok(workflow, 'get workflow ok');
    t.equivalent(workflow, aWorkflow);
    backend.getWorkflow(uuid(), function (err, workflow) {
      t.equal(typeof (err), 'object');
      t.equal(err.name, 'BackendResourceNotFoundError');
      t.ok(err.message.match(/uuid/gi), 'unexisting workflow error');
      t.end();
    });
  });
});


test('update workflow', function (t) {
  aWorkflow.chain.push({
    name: 'Another task',
    body: function (job, cb) {
      return cb(null);
    }.toString()
  });
  aWorkflow.name = 'A workflow name';
  backend.updateWorkflow(aWorkflow, function (err, workflow) {
    t.ifError(err, 'update workflow error');
    t.ok(workflow, 'update workflow ok');
    t.ok(workflow.chain[1].name, 'Updated task ok');
    t.ok(workflow.chain[1].body, 'Updated task body ok');
    t.end();
  });
});


test('create job', function (t) {
  factory.job({
    workflow: aWorkflow.uuid,
    target: '/foo/bar',
    params: {
      a: '1',
      b: '2'
    }
  }, function (err, job) {
    t.ifError(err, 'create job error');
    t.ok(job, 'create job ok');
    t.ok(job.exec_after, 'job exec_after');
    t.equal(job.execution, 'queued', 'job queued');
    t.ok(job.uuid, 'job uuid');
    t.ok(util.isArray(job.chain), 'job chain is array');
    t.ok(util.isArray(job.onerror), 'job onerror is array');
    t.ok(
      (typeof (job.params) === 'object' && !util.isArray(job.params)),
      'params ok');
    aJob = job;
    backend.getJobProperty(aJob.uuid, 'target', function (err, val) {
      t.ifError(err, 'get job property error');
      t.equal(val, '/foo/bar', 'property value ok');
      t.end();
    });
  });
});


test('duplicated job target', function (t) {
  factory.job({
    workflow: aWorkflow.uuid,
    target: '/foo/bar',
    params: {
      a: '1',
      b: '2'
    }
  }, function (err, job) {
    t.ok(err, 'duplicated job error');
    t.end();
  });
});


test('job with different params', function (t) {
  factory.job({
    workflow: aWorkflow.uuid,
    target: '/foo/bar',
    params: {
      a: '2',
      b: '1'
    }
  }, function (err, job) {
    t.ifError(err, 'create job error');
    t.ok(job, 'create job ok');
    t.ok(job.exec_after);
    t.equal(job.execution, 'queued');
    t.ok(job.uuid);
    t.ok(util.isArray(job.chain), 'job chain is array');
    t.ok(util.isArray(job.onerror), 'job onerror is array');
    t.ok(
      (typeof (job.params) === 'object' && !util.isArray(job.params)),
      'params ok');
    anotherJob = job;
    t.end();
  });
});


test('next jobs', function (t) {
  backend.nextJobs(0, 1, function (err, jobs) {
    t.ifError(err, 'next jobs error');
    t.equal(jobs.length, 2);
    // TODO: sorting on moray is pending
    // t.equal(jobs[0], aJob.uuid);
    // t.equal(jobs[1], anotherJob.uuid);
    t.end();
  });
});


test('next queued job', function (t) {
  var idx = 0;
  backend.nextJob(function (err, job) {
    t.ifError(err, 'next job error' + idx);
    idx += 1;
    t.ok(job, 'first queued job OK');
    // TODO: sorting on moray is pending
    // t.equal(aJob.uuid, job.uuid);
    backend.nextJob(idx, function (err, job) {
      t.ifError(err, 'next job error: ' + idx);
      idx += 1;
      t.ok(job, '2nd queued job OK');
      // TODO: sorting on moray is pending
      //t.notEqual(aJob.uuid, job.uuid);
      backend.nextJob(idx, function (err, job) {
        console.dir(job);
        t.ifError(err, 'next job error: ' + idx);
        t.equal(job, null, 'no more queued jobs');
        t.end();
      });
    });
  });
});


test('teardown', function (t) {
  async.forEach(['wf_workflows', 'wf_jobs', 'wf_runners'],
    function (bucket, cb) {
      backend._bucketExists(bucket, function (exists) {
        if (exists) {
          return backend.client.delBucket(bucket, function (err) {
            t.ifError(err, 'Delete ' + bucket + ' bucket error');
            return cb(err);
          });
        } else {
          return cb(null);
        }
      });
    }, function (err) {
      t.ifError(err, 'Delete buckets error');
      backend.quit(function () {
        console.timeEnd('Moray Backend');
        t.end();
      });

    });
});

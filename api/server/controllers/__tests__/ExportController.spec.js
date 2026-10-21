const { EventEmitter } = require('events');
const { createExportController } = require('~/server/controllers/ExportController');

function createRes() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.statusCode = 200;
  res.headers = {};
  res.body = undefined;
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body) => {
    res.body = body;
    res.headersSent = true;
    return res;
  });
  res.setHeader = jest.fn((name, value) => {
    res.headers[name] = value;
  });
  return res;
}

const req = (id) => ({ user: { id, email: `${id}@memodo.de` } });

/** A run that stays open until the test calls `finish()` for that user. */
function blockingRun() {
  const pending = new Map();
  const run = jest.fn(
    ({ user, onReady }) =>
      new Promise((resolve) => {
        onReady({ filename: `memodoai-export-${user.id}-2026-10-21.zip` });
        pending.set(user.id, resolve);
      }),
  );
  const finish = (id) => {
    pending.get(id)('success');
    return new Promise((resolve) => setImmediate(resolve));
  };
  return { run, finish };
}

const deps = (run) => ({ run, fileAccess: () => ({}), getModels: () => ({}) });

describe('exportUserDataController', () => {
  it('streams with zip headers derived from the prepared export', async () => {
    const { run, finish } = blockingRun();
    const controller = createExportController(deps(run));
    const res = createRes();

    const done = controller(req('u1'), res);
    await finish('u1');
    await done;

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: 'u1', email: 'u1@memodo.de' }, output: res }),
    );
    expect(res.headers['Content-Type']).toBe('application/zip');
    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename="memodoai-export-u1-2026-10-21.zip"',
    );
  });

  it('allows one export per user', async () => {
    const { run, finish } = blockingRun();
    const controller = createExportController(deps(run));

    const first = controller(req('u1'), createRes());
    const second = createRes();
    await controller(req('u1'), second);

    expect(second.statusCode).toBe(429);
    expect(second.body).toEqual({ error: 'export_in_progress' });
    await finish('u1');
    await first;
  });

  it('caps concurrent exports server-wide', async () => {
    const { run, finish } = blockingRun();
    const controller = createExportController({ ...deps(run), maxConcurrent: 3 });

    const running = ['u1', 'u2', 'u3'].map((id) => controller(req(id), createRes()));
    const fourth = createRes();
    await controller(req('u4'), fourth);

    expect(fourth.statusCode).toBe(429);
    expect(fourth.body).toEqual({ error: 'export_busy' });
    await Promise.all(['u1', 'u2', 'u3'].map(finish));
    await Promise.all(running);
  });

  it('releases the slot after completion', async () => {
    const { run, finish } = blockingRun();
    const controller = createExportController(deps(run));

    const first = controller(req('u1'), createRes());
    await finish('u1');
    await first;

    const again = controller(req('u1'), createRes());
    expect(run).toHaveBeenCalledTimes(2);
    await finish('u1');
    await again;
  });

  it('releases the slot as soon as the client disconnects', async () => {
    const { run, finish } = blockingRun();
    const controller = createExportController({ ...deps(run), maxConcurrent: 1 });
    const res = createRes();

    const first = controller(req('u1'), res);
    res.emit('close');

    const other = controller(req('u2'), createRes());
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][0].isAborted()).toBe(true);
    await Promise.all([finish('u1'), finish('u2')]);
    await Promise.all([first, other]);
  });

  it('answers 500 when preparation fails before streaming, and frees the slot', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new Error('mongo down'))
      .mockResolvedValueOnce('success');
    const controller = createExportController(deps(run));
    const res = createRes();

    await controller(req('u1'), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'export_failed' });

    await controller(req('u1'), createRes());
    expect(run).toHaveBeenCalledTimes(2);
  });
});

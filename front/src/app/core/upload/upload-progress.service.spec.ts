import { TestBed } from '@angular/core/testing';
import { UploadProgressService } from './upload-progress.service';

describe('UploadProgressService', () => {
  let svc: UploadProgressService;
  beforeEach(() => {
    jest.useFakeTimers();
    svc = TestBed.inject(UploadProgressService);
  });
  afterEach(() => jest.useRealTimers());

  it('tracks a job from sending to processing to done, then removes it', () => {
    const id = svc.start('offer.pdf');
    expect(svc.jobs()).toEqual([{ id, label: 'offer.pdf', percent: null, phase: 'sending' }]);
    expect(svc.active()).toBe(true);

    svc.progress(id, 50, 200);
    expect(svc.jobs()[0]).toMatchObject({ percent: 25, phase: 'sending' });
    svc.progress(id, 200, 200);
    expect(svc.jobs()[0]).toMatchObject({ percent: 100, phase: 'processing' });

    svc.finish(id, true);
    expect(svc.jobs()[0].phase).toBe('done');
    expect(svc.active()).toBe(false);
    jest.advanceTimersByTime(1500);
    expect(svc.jobs()).toEqual([]);
  });

  it('unknown totals keep percent null; failures linger longer and keep the last percent', () => {
    const id = svc.start('a.pdf');
    svc.progress(id, 10, undefined);
    expect(svc.jobs()[0].percent).toBeNull();
    svc.progress(id, 30, 100);
    svc.finish(id, false);
    expect(svc.jobs()[0]).toMatchObject({ phase: 'failed', percent: 30 });
    jest.advanceTimersByTime(1500);
    expect(svc.jobs()).toHaveLength(1);
    jest.advanceTimersByTime(2500);
    expect(svc.jobs()).toHaveLength(0);
  });

  it('dismiss removes a job immediately; ids are unique', () => {
    const a = svc.start('a');
    const b = svc.start('b');
    expect(a).not.toBe(b);
    svc.dismiss(a);
    expect(svc.jobs().map((j) => j.id)).toEqual([b]);
  });
});

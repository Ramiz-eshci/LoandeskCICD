export type TaskBucket = 'overdue' | 'today' | 'upcoming';
export type TaskPriority = 'High' | 'Medium' | 'Low';

export interface WorkTask {
  type: string;
  priority: TaskPriority;
  subject: string;
  reference: string;
  due: string;
  bucket: TaskBucket;
}

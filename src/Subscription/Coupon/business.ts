import dayjs from 'dayjs'
import { BRT, now } from '../../config/dayjs'
import { ScheduledJobRunModel } from '../../models/externalModels/ScheduledJobRun'

export async function getJobNextReferenceDate(jobName: string) {
  const job = await ScheduledJobRunModel.findOne({ name: jobName })

  const endDate = now().subtract(7, 'days').endOf('day')
  let startDate = now().subtract(7, 'days').startOf('day')

  if (!job?.lastSucessfulRun) {
    return {
      startDate,
      endDate
    }
  }

  startDate = dayjs(job.lastSucessfulRun).tz(BRT).utc(true).subtract(6, 'days').startOf('day')
  return {
    startDate,
    endDate
  }
}

export async function saveNewSucessfulJobRunDate(jobName: string) {
  await ScheduledJobRunModel.findOneAndUpdate(
    { name: jobName },
    { lastSucessfulRun: now().toDate() },
    { upsert: true }
  )
}

import { enqueueSubscriptionsThatUsedCoupon } from '../../adapters/jobs'
import env from '../../config/env'
import { ChargeModel } from '../../models/externalModels/Charge'
import { getJobNextReferenceDate, saveNewSucessfulJobRunDate } from './business'

export default (fastify: any, options: any, done: any) => {
  fastify.post('/process-subscriptions-with-coupon', async (request: any, reply: any) => {
    const referenceDate = await getJobNextReferenceDate(
      env.SCHEDULED_ENQUEUER_SUBSCRIPTIONS_WITH_COUPON
    )
    const subscriptionsThatUsedCoupon = await ChargeModel.aggregate([
      {
        $match: {
          createdAt: {
            $gte: referenceDate.startDate.toDate(),
            $lt: referenceDate.endDate.toDate()
          },
          couponCode: { $nin: [null, ''] }
        }
      }
    ]).exec()

    await enqueueSubscriptionsThatUsedCoupon(subscriptionsThatUsedCoupon)
    await saveNewSucessfulJobRunDate(env.SCHEDULED_ENQUEUER_SUBSCRIPTIONS_WITH_COUPON)
    return
  })

  done()
}

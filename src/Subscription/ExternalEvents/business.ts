import { expire } from '../../business/subscription/actions'
import {
  RevenueCatEventBody,
  RevenueCatEventCancellationAndExpirationReasons,
  RevenueCatEventModel,
  RevenueCatEventType
} from '../../models/RevenueCatEvent'
import { SubscriptionAgent, UserModel } from '../../models/UserTypegoose'
import { processPlanAquisitionOrRenewal } from './newPlan.business'

export const revenueCatEventHandlers: Partial<
  Record<RevenueCatEventType, (eventBody: RevenueCatEventBody) => Promise<any>>
> = {
  [RevenueCatEventType.CANCELLATION]: handleCancellationEvent,
  [RevenueCatEventType.UNCANCELLATION]: handleUncancellationEvent,
  [RevenueCatEventType.EXPIRATION]: handleExpirationEvent,
  [RevenueCatEventType.INITIAL_PURCHASE]: handlePlanAquisitionOrRenewal,
  [RevenueCatEventType.RENEWAL]: handlePlanAquisitionOrRenewal
}

async function handleCancellationEvent(eventBody: RevenueCatEventBody) {
  const user = await UserModel.findById(eventBody.app_user_id)

  if (!user) {
    throw new Error(`User ${eventBody.app_user_id} not found`)
  }

  const isRefund =
    eventBody.cancel_reason == RevenueCatEventCancellationAndExpirationReasons.CUSTOMER_SUPPORT

  if (isRefund) {
    await expire(SubscriptionAgent.USER, user)
    await RevenueCatEventModel.create(eventBody)

    return
  }

  await user.unsubscribe()
}

async function handleUncancellationEvent(eventBody: RevenueCatEventBody) {
  const user = await UserModel.findById(eventBody.app_user_id)

  if (!user) {
    throw new Error(`User ${eventBody.app_user_id} not found`)
  }

  await user.resubscribe()
}

async function handleExpirationEvent(eventBody: RevenueCatEventBody) {
  const user = await UserModel.findById(eventBody.app_user_id)

  if (!user) {
    throw new Error(`User ${eventBody.app_user_id} not found`)
  }

  await expire(SubscriptionAgent.SYSTEM, user)
}

async function handlePlanAquisitionOrRenewal(eventBody: RevenueCatEventBody) {
  const user = await UserModel.findById(eventBody.app_user_id)

  if (!user) {
    throw new Error(`User ${eventBody.app_user_id} not found`)
  }

  await processPlanAquisitionOrRenewal(eventBody, user)
}

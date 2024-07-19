import { DocumentType } from '@typegoose/typegoose'
import dayjs from 'dayjs'
import { enqueueRDstationEvents } from '../../adapters/jobs'
import { emitEvent } from '../../adapters/pubsub'
import { CouponType } from '../../business/coupon'
import { crashlessError, crashlessException } from '../../business/errors'
import { cleanReferralCodeFromSubscriberAttributes } from '../../business/subscribeToNewPlan'
import { BRT } from '../../config/dayjs'
import env from '../../config/env'
import { ChargeModel } from '../../models/externalModels/Charge'
import { Plan, PlanModel } from '../../models/Plan'
import { RevenueCatEventBody, RevenueCatEventModel } from '../../models/RevenueCatEvent'
import {
  SubscriptionAction,
  SubscriptionAgent,
  UserModel,
  UserSubscriptionManagementType,
  UserTypegoose
} from '../../models/UserTypegoose'

export async function processPlanAquisitionOrRenewal(
  event: RevenueCatEventBody,
  user: DocumentType<UserTypegoose>
) {
  const userId = user._id
  const subscribedPlan = await getEventPlan(event)

  const { couponCode, couponGroup, couponType } = await findCouponUsedOnPurchase(user, event)

  const requestedDate = dayjs(event.purchased_at_ms)

  const charge = await ChargeModel.create({
    userId: userId,
    planId: subscribedPlan._id,
    requestedDate: requestedDate.toDate(),
    couponCode,
    couponType,
    iapCouponGroup: couponGroup
  })
  try {
    await updateActivePlan(user, subscribedPlan, requestedDate)
  } catch (error) {
    console.error(`[WEBHOOK] error processing ${event.type} for user ${event.app_user_id}: `, error)
    await ChargeModel.findByIdAndDelete(charge.id)
    throw error
  }

  const isNewPlan = user.currentSubscription.planId !== subscribedPlan._id

  await postPurchaseProcessingActions(
    event,
    isNewPlan,
    userId,
    user.email,
    user.name,
    couponCode,
    couponType
  )
}

async function getEventPlan(event: RevenueCatEventBody) {
  const planPartnerValue = event.subscriber_attributes?.planPartner?.value
  let plan
  let errorMessage

  if (planPartnerValue) {
    errorMessage = `[Webhook] There's no plan for planPartner: ${planPartnerValue}`
    plan = await PlanModel.findById(planPartnerValue)
  } else {
    errorMessage = `[Webhook] There's no plan for app store alias: ${event.product_id}`
    plan = await PlanModel.findOne({
      $or: [
        { 'properties.appStoreAlias': event.product_id },
        { 'properties.referralProgramDiscountedPlan': event.product_id }
      ]
    })
  }

  if (!plan) {
    throw new Error(errorMessage)
  }

  return plan
}

async function updateActivePlan(
  user: DocumentType<UserTypegoose>,
  targetPlan: Plan,
  requestedDate: dayjs.Dayjs,
  autoRenew: boolean = true,
  subscriptionManagementType: UserSubscriptionManagementType = UserSubscriptionManagementType.EXTERNAL
) {
  const userId = user._id
  console.info(`[Update Active Plan] Updating ${userId} plan...`)

  const startDate = dayjs.tz(requestedDate, BRT).startOf('day').utc(true)
  const expirationDate = targetPlan.getExpirationDate(startDate)
  const currentPlan = await user.getPlan()

  let action = SubscriptionAction.SUBSCRIBE
  let agent = SubscriptionAgent.USER

  if (currentPlan.properties.subscriptionBased) {
    action = SubscriptionAction.UPGRADE
  }

  if (targetPlan._id === currentPlan._id) {
    action = SubscriptionAction.RENEW
    agent = SubscriptionAgent.SYSTEM
  }

  await user.changeCurrentSubscription(
    { agent, action, planId: targetPlan._id, startDate, expirationDate },
    { autoRenew, subscriptionManagementType }
  )

  console.info(`[Update Active Plan] Finished updating ${userId} plan`)
  return {}
}

async function postPurchaseProcessingActions(
  event: any,
  isNewPlan: boolean,
  userId: string,
  userEmail: string,
  userName: string,
  usedCouponCode?: string,
  couponType?: CouponType
) {
  try {
    if (env.isProduction) {
      await Promise.all([
        await RevenueCatEventModel.create(event),

        await enqueueRDstationEvents(userEmail, 'Pagamento de subscrição realizado com sucesso', {
          userName
        }),

        await handleReferralCodePostActions(userId, isNewPlan, usedCouponCode, couponType),

        await cleanUpCouponCode(userId, usedCouponCode)
      ])
    }
  } catch (error: any) {
    crashlessException('postPurchaseProcessingActions', error, userId)
  }
}

async function findCouponUsedOnPurchase(user: DocumentType<UserTypegoose>, event: any) {
  const incomingCouponGroup: string | null = event.offer_code

  if (!incomingCouponGroup) return {}

  const isReferralGroup = env.REFERRAL_PROGRAM_IAP_GROUPS.includes(incomingCouponGroup)
  const couponType = isReferralGroup ? CouponType.Referral : CouponType.Default

  if (user.iapOngoingCoupon) {
    const { code, type, group } = user.iapOngoingCoupon

    const ongoingCouponValid = isOngoingCouponValid(user._id, incomingCouponGroup, type, group)

    if (ongoingCouponValid)
      return {
        couponCode: code,
        couponGroup: incomingCouponGroup,
        couponType: type
      }

    return { couponGroup: incomingCouponGroup, couponType }
  }

  /**
   * @deprecated: This code is intended to maintain backward compatibility
   * with users who have the app version that still updates the referralCode in RevenueCat.
   */

  /**@todo: Remove code when the app is no longer updating the referralCode in RevenueCat. */

  const deprecatedReferralCode = event.subscriber_attributes?.referralCodeUsed?.value

  const referralCodeUpdatedDate = dayjs.utc(
    event.subscriber_attributes?.referralCodeUsed?.updated_at_ms
  )

  const expirationThreshold = dayjs.utc().subtract(2, 'h')

  const isReferralCodeExpired = referralCodeUpdatedDate.isBefore(expirationThreshold)

  const couponCode =
    deprecatedReferralCode && !isReferralCodeExpired ? deprecatedReferralCode : undefined

  return {
    couponGroup: incomingCouponGroup,
    couponType,
    couponCode
  }
}

function isOngoingCouponValid(
  userId: string,
  incomingCouponGroup: string,
  ongoingCouponType: string,
  ongoingCouponGroup?: string
) {
  if (ongoingCouponType === CouponType.Referral) {
    const isReferralCouponValid = env.REFERRAL_PROGRAM_IAP_GROUPS.includes(incomingCouponGroup)

    if (isReferralCouponValid) return true

    crashlessError(
      `Referral incoming coupon group is not present on REFERRAL_PROGRAM_IAP_GROUPS list`,
      userId,
      { incomingCouponGroup }
    )

    return false
  }

  if (ongoingCouponType === CouponType.Default) {
    const isDefaultCouponValid =
      ongoingCouponGroup === incomingCouponGroup &&
      !env.REFERRAL_PROGRAM_IAP_GROUPS.includes(incomingCouponGroup)
    if (isDefaultCouponValid) return true

    crashlessError(`Ongoing coupon group is not equals incoming coupon group`, userId, {
      ongoingCouponGroup,
      incomingCouponGroup
    })

    return false
  }

  crashlessError(`Ongoing coupon is invalid`, userId, {
    ongoingCouponGroup,
    incomingCouponGroup,
    ongoingCouponType
  })

  return false
}

async function handleReferralCodePostActions(
  userId: string,
  isNewPlan: boolean,
  usedCouponCode?: string,
  couponType?: CouponType
) {
  if (couponType != CouponType.Referral) return

  if (!isNewPlan || !usedCouponCode) return

  console.info(`[handleReferralCodePostActions] Referral code ${usedCouponCode} used by ${userId}`)

  await emitEvent('referral-code-used', userId, {
    code: usedCouponCode
  })
}

async function cleanUpCouponCode(userId: string, code?: string) {
  console.info(`[cleanUpCouponCode] Cleaning up coupon code ${code} for ${userId}`)

  await UserModel.findByIdAndUpdate(userId, {
    $unset: { iapOngoingCoupon: 1 }
  })

  /**@todo: Remove code when the app is no longer updating the referralCode in RevenueCat. */
  await cleanReferralCodeFromSubscriberAttributes(userId)
}

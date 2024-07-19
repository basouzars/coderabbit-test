import axios from 'axios'
import dayjs from 'dayjs'
import env from '../../config/env'

interface APIRequestConfiguration {
  [key: string]: {
    route: (userId: string) => string
    body?: () => Object
    method: Function
  }
}

export enum ApiRequestTypes {
  CLEAN_REFERRAL_CODE_FROM_SUBSCRIBER_ATTRIBUTES = 'CLEAN_REFERRAL_CODE_FROM_SUBSCRIBER_ATTRIBUTES'
}

const callsConfiguration: APIRequestConfiguration = {
  [ApiRequestTypes.CLEAN_REFERRAL_CODE_FROM_SUBSCRIBER_ATTRIBUTES]: {
    route: (userId: string) => `https://api.revenuecat.com/v1/subscribers/${userId}/attributes`,
    body: () => ({
      attributes: {
        referralCodeUsed: {
          value: null,
          updated_at_ms: dayjs.utc().valueOf()
        }
      }
    }),
    method: axios.post
  }
}

export async function makeApiCallToRevenueCat(apiRequestType: ApiRequestTypes, userId: string) {
  const configuration = callsConfiguration[apiRequestType]
  const headers = {
    headers: { Authorization: `Bearer ${env.REVENUE_CAT_API_KEY}` }
  }

  try {
    if (!!configuration.body) {
      return await configuration.method(configuration.route(userId), configuration.body(), headers)
    }

    return await configuration.method(configuration.route(userId), headers)
  } catch (error) {
    console.error(`[makeApiCallToRevenueCat] Api call to ${userId} failed with error: `, error)
  }
}

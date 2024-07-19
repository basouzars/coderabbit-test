import env from '../../config/env'
import { revenueCatApiKeyAuthenticator } from '../../middlewares/rest'
import { RevenueCatEventBody } from '../../models/RevenueCatEvent'
import { revenueCatEventHandlers } from './business'

export default (fastify: any, options: any, done: any) => {
  fastify.addHook('preHandler', revenueCatApiKeyAuthenticator)

  fastify.post('/', async (request: any, reply: any) => {
    const eventBody: RevenueCatEventBody = request.body.event

    console.info(
      `[Webhook-RevenueCat] Received webhook event for user: ${eventBody.app_user_id} type: ${eventBody.type} event_id: ${eventBody.id}`
    )

    ensureValidRevenueCatEnvironment(eventBody)

    const eventHandler = revenueCatEventHandlers[eventBody.type]

    if (!eventHandler) {
      console.info(
        `[Webhook-RevenueCat] Webhook event type not supported for user: ${eventBody.app_user_id} type: ${eventBody.type} event_id: ${eventBody.id}`
      )
      return
    }

    await eventHandler(eventBody)

    return
  })

  done()
}

const ensureValidRevenueCatEnvironment = (event: RevenueCatEventBody) => {
  const validPairs = {
    SANDBOX: env.isDevelopment,
    PRODUCTION: env.isProduction
  }

  if (!validPairs[event.environment]) {
    const errorDetails = {
      'Application environment': process.env.NODE_ENV,
      'Event environment': event.environment,
      'Full event': event
    }

    throw Error(
      `Received revenue cat webhook in invalid environment: ${JSON.stringify(errorDetails)}`
    )
  }
}

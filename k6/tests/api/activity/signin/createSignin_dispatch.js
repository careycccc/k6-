import { createSignin } from './createSignin.js';
import { logger } from '../../../../libs/utils/logger.js';

export default function () {
    // K6 requires a default function. We wrap the existing createSignin logic.
    // Assuming the API requires an auth token, in a real scenario this might be fetched
    // before calling createSignin, or passed via environment variables.

    // If there is any required data, we can mock or construct it here.
    const token = __ENV.K6_TOKEN || 'test-token-for-dispatch';
    
    logger.info(`[createSignin_dispatch] Executing createSignin flow for platform: ${__ENV.TARGET_PLATFORM || 'default'}`);

    const result = createSignin({ token: token });
    
    logger.info(`[createSignin_dispatch] Result: ${JSON.stringify(result)}`);
}

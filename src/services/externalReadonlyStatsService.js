import { externalReadonlyApiClient } from './externalReadonlyApiClient.js';

export async function getExternalReadonlyStatus() {
    return externalReadonlyApiClient.getStatus();
}

export async function getExternalReadonlyStats() {
    return externalReadonlyApiClient.getStats();
}

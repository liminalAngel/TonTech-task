import { toNano } from '@ton/core';
import { Escrow } from '../wrappers/Escrow';
import { compile, NetworkProvider } from '@ton/blueprint';

const NEEDED_AMOUNT = toNano('10');
const GUARANTOR_ROYALTIES = toNano('0.05');

export async function run(provider: NetworkProvider) {
    const escrow = provider.open(Escrow.createFromConfig({}, await compile('Task')));

    await escrow.sendDeploy(provider.sender(), NEEDED_AMOUNT, toNano('0.05'));

    await provider.waitForDeploy(escrow.address);

    // run methods on `task`
}

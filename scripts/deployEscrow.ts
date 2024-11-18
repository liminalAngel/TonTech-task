import { Address, toNano } from '@ton/core';
import { Escrow } from '../wrappers/Escrow';
import { compile, NetworkProvider } from '@ton/blueprint';

const NEEDED_AMOUNT = toNano('10');
const GUARANTOR_ROYALTIES = 250;

const BUYER_ADDRESS = Address.parse('')
const SELLER_ADDRESS = Address.parse('')
const GUARANTOR_ADDRESS = Address.parse('')

export async function run(provider: NetworkProvider) {
    const escrow = provider.open(
        Escrow.createFromConfig(
            {
                jettonPayment: false,
                dealId: 0n,
                confirmationDuration: Math.floor(Date.now() / 1000) + 60 * 10,
                neededAmount: NEEDED_AMOUNT,
                buyer: BUYER_ADDRESS,
                seller: SELLER_ADDRESS,
                guarantor: GUARANTOR_ADDRESS,
                guarantorRoyalties: GUARANTOR_ROYALTIES
            }, 
            await compile('Task')
        )
    );

    await escrow.sendDeploy(provider.sender(), NEEDED_AMOUNT, toNano('0.05'));

    await provider.waitForDeploy(escrow.address);

    // run methods on `task`
}

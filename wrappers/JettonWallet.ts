import { Address, beginCell, Cell, Contract, ContractProvider, Sender, SendMode } from '@ton/core';

export class JettonWallet implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new JettonWallet(address);
    }

    async sendTransfer(
        provider: ContractProvider, via: Sender,
        opts: {
            value: bigint,
            toAddress: Address,
            fwdAmount: bigint,
            jettonAmount: bigint,
            fwdPayload: Cell,
            queryId?: number
        }
    ) {
        const body = beginCell()
            .storeUint(0xf8a7ea5, 32)
            .storeUint(opts.queryId ?? 0, 64)
            .storeCoins(opts.jettonAmount)
            .storeAddress(opts.toAddress)
            .storeAddress(via.address)
            .storeBit(false)
            .storeCoins(opts.fwdAmount)
            .storeBit(!!opts.fwdPayload)

        if (!!opts.fwdPayload)
            body.storeRef(opts.fwdPayload || null)

        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: body.endCell(),
        });
    }

    async getJettonBalance(provider: ContractProvider): Promise<bigint> {
        const result = (await provider.get('get_wallet_data', [])).stack;
        return result.readBigNumber();
    }
}

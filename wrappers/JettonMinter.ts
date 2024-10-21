import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';

export type JettonMinterConfig = {
    admin: Address; 
    content: Cell; 
    walletСode: Cell
};

export function jettonMinterConfigToCell(config: JettonMinterConfig): Cell {
    return beginCell()
        .storeCoins(0)
        .storeAddress(config.admin)
        .storeRef(config.content)
        .storeRef(config.walletСode)
    .endCell();
}

export function jettonContentToCell(uri: string): Cell {
    return beginCell()
        .storeUint(1, 8)
        .storeStringTail(uri)
    .endCell();
}

export class JettonMinter implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new JettonMinter(address);
    }

    static createFromConfig(config: JettonMinterConfig, code: Cell, workchain = 0) {
        const data = jettonMinterConfigToCell(config);
        const init = { code, data };
        return new JettonMinter(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendMint(
        provider: ContractProvider,
        via: Sender,
        opts: {
            to: Address;
            jettonAmount: bigint;
            fwdTonAmount: bigint;
            totalTonAmount: bigint;
        }
    ) {
        await provider.internal(via, {
            value: toNano('0.1') + opts.totalTonAmount,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0x1674b0a0, 32)
                .storeUint(0, 64) 
                .storeAddress(opts.to)
                .storeCoins(opts.jettonAmount)
                .storeCoins(opts.fwdTonAmount)
                .storeCoins(opts.totalTonAmount)
            .endCell()     
        });
    }

    async getWalletAddress(provider: ContractProvider, owner: Address): Promise<Address> {
        const result = (await provider.get('get_wallet_address', [{ type: 'slice', cell: beginCell().storeAddress(owner).endCell() }])).stack
        return result.readAddress()
    }
}

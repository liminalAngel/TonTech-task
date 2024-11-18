import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';
import { Opcodes } from './constants';

export interface EscrowData {
    jettonPayment: boolean;
    dealId: bigint;
    confirmationDuration: number;
    neededAmount: bigint;
    buyer: Address;
    seller: Address;
    guarantor: Address;
    guarantorRoyalties: number;
};

export interface GetStorageData extends EscrowData {
    init: boolean;
    startTime: number;
    escrowWallet: Address | null;
}

export function escrowConfigToCell(config: EscrowData): Cell {
    return beginCell()
        .storeBit(false)
        .storeBit(config.jettonPayment)
        .storeUint(config.dealId, 64)
        .storeUint(0, 32)
        .storeUint(config.confirmationDuration, 32)
        .storeCoins(config.neededAmount)
        .storeAddress(config.buyer)
        .storeAddress(config.seller)
        .storeAddress(config.guarantor)
        .storeUint(config.guarantorRoyalties, 10)
        .storeRef(
            beginCell()
                .storeUint(0, 2)
            .endCell()
        )
    .endCell();
}

export class Escrow implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Escrow(address);
    }

    static createFromConfig(config: EscrowData, code: Cell, workchain = 0) {
        const data = escrowConfigToCell(config);
        const init = { code, data };
        return new Escrow(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, neededAmount: bigint, value: bigint, escrowJettonWallet?: Address) {
        let body = beginCell().storeCoins(neededAmount)
        if (!!escrowJettonWallet) {
            body.storeAddress(escrowJettonWallet)
        }
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: body.endCell(),
        });
    }

    async sendMessage(provider: ContractProvider, via: Sender, 
        opts: {
            value: bigint;
            op: Opcodes,
            queryId?: bigint;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(opts.op, 32)
                .storeUint(opts.queryId ?? 0, 64)
            .endCell(),
        });
    }

    async getStorageData(provider: ContractProvider): Promise<GetStorageData> {
        const result = (await provider.get('get_storage_data', [])).stack;
        return {
            init: result.readBoolean(),
            jettonPayment: result.readBoolean(),
            dealId: result.readBigNumber(),
            startTime: result.readNumber(),
            confirmationDuration: result.readNumber(),
            neededAmount: result.readBigNumber(),
            buyer: result.readAddress(),
            seller: result.readAddress(),
            guarantor: result.readAddress(),
            guarantorRoyalties: result.readNumber(),
            escrowWallet: result.readAddressOpt()
        }
    }
}

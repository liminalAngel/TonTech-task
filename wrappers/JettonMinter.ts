import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano, TupleItemSlice } from '@ton/core';
import { JettonWalletOpCodes } from './JettonWallet';

export type JettonMinterConfig = {
    admin: Address;
    content: Cell;
    jettonWalletCode: Cell;
};

export const jettonMinterCode = 'te6cckECCwEAAe4AART/APSkE/S88sgLAQIBYgIIAgLLAwcD79DIhxwCRW+DQ0wMBcbCRW+D6QDAB0x/TP+1E0PoA+kDU1DCAFVJwuo4wNTVRVccF8uBJAfpA+gDUMCDQgGDXIfoAMCUQNFBC8B2gVSDIUAT6AljPFszMye1U4IIQe92X3lJwuuMCNSXAA+MCMATABOMCXwWEF/LwgQFBgD+NgP6APpA+ChUEghwVCATVBQDyFAE+gJYzxYBzxbMySLIywES9AD0AMsAyfkAcHTIywLKB8v/ydBQCMcF8uBKEqEDUCTIUAT6AljPFszMye1UAfpAMCDXCwHDAI4fghDVMnbbcIAQyMsFUAPPFiL6AhLLassfyz/JgEL7AJFb4gAwNRXHBfLgSfpAMFnIUAT6AljPFszMye1UAC5RQ8cF8uBJ1DAByFAE+gJYzxbMzMntVACVpvwUIgG4KhAJqgoB5CgCfQEsZ4sA54tmZJFkZYCJegB6AGWAZJB8gDg6ZGWBZQPl/+ToO8AMZGWCrGeLKAJ9AQnltYlmZmS4/YBAAgN6YAkKAH2tvPaiaH0AfSBqahg2GPwUALgqEAmqCgHkKAJ9ASxniwDni2ZkkWRlgIl6AHoAZYBk/IA4OmRlgWUD5f/k6EAAH68W9qJofQB9IGpqGD+qkEClxnrN'

export const JettonMinterOpCodes = {
    mint: 21,
    burnNotification: 0x7bdd97de,
    changeAdmin: 3,
    changeContent: 4,

    excesses: 0xd53276db
}

export const JettonMinterErrors = {
    noErrors: 0,

    notFromAdmin: 73,
    notFromJettonWallet: 74,

    unknownOp: 0xffff
}

export function jettonMinterConfigToCell(config: JettonMinterConfig): Cell {
    return beginCell()
        .storeCoins(0)
        .storeAddress(config.admin)
        .storeRef(config.content)
        .storeRef(config.jettonWalletCode)
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
            queryId?: number;
            toAddress: Address;
            jettonAmount: bigint;
        }
    ) {
        await provider.internal(via, {
            value: toNano('0.1'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(JettonMinterOpCodes.mint, 32)
                .storeUint(opts.queryId ?? 0, 64)
                .storeAddress(opts.toAddress)
                .storeCoins(toNano('0.05'))
                .storeRef(
                    beginCell()
                        .storeUint(JettonWalletOpCodes.internalTransfer, 32)
                        .storeUint(0, 64)
                        .storeCoins(opts.jettonAmount)
                        .storeAddress(this.address)
                        .storeAddress(opts.toAddress)
                        .storeCoins(0)
                        .storeBit(false)
                    .endCell()
                )
            .endCell(),
        });
    }

    async getWalletAddress(provider: ContractProvider, address: Address): Promise<Address> {
        const result = await provider.get('get_wallet_address', [
            {   
                type: 'slice', 
                cell: beginCell().storeAddress(address).endCell(),
            } as TupleItemSlice,
        ]);
        return result.stack.readAddress();
    }
}
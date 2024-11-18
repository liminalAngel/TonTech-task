import { Address, beginCell, Cell, Contract, ContractProvider, Sender, SendMode, toNano } from '@ton/core';

export const jettonWalletCode = 'te6cckECEgEAAzQAART/APSkE/S88sgLAQIBYgIRAgLKAxACASAEBQDD0IMcAkl8E4AHQ0wMBcbCVE18D8CDg+kD6QDH6ADFx1yH6ADH6ADBzqbQAAtMfghAPin6lUiC6lTE0WfAd4IIQF41FGVIgupYxREQD8B7gNYIQWV8HvLqTWfAf4F8EhBfy8ICASAGBwARvfSIYOF15cKbAgFYCAoB8VA9M/+gD6QCHwFu1E0PoA+kD6QNQwUTahUirHBfLiwSjC//LiwlQ0QnBUIBNUFAPIUAT6AljPFgHPFszJIsjLARL0APQAywDJIPkAcHTIywLKB8v/ydAE+kD0BDH6ACDXScIA8uLEd4AYyMsFUAjPFnD6AhfLaxPMgJAK6CEBeNRRnIyx8Zyz9QB/oCIs8WUAbPFiX6AlADzxbJUAXMI5FykXHiUAioE6CCCOThwKoAggiYloCgoBS88uLFBMmAQPsAECPIUAT6AljPFgHPFszJ7VQCASALDwP3O1E0PoA+kD6QNQwCNM/+gBRUaAF+kD6QFNbxwVUc21wVCATVBQDyFAE+gJYzxYBzxbMySLIywES9AD0AMsAyfkAcHTIywLKB8v/ydBQDccFHLHy4sMK+gBRqKGCCJiWgIIImJaAErYIoYII5OHAoBihJ+MPJdcLAcMAI4AwNDgBwUnmgGKGCEHNi0JzIyx9SMMs/WPoCUAfPFlAHzxbJcYAQyMsFJM8WUAb6AhXLahTMyXH7ABAkECMADhBJEDg3XwQAdsIAsI4hghDVMnbbcIAQyMsFUAjPFlAE+gIWy2oSyx8Syz/JcvsAkzVsIeIDyFAE+gJYzxYBzxbMye1UANs7UTQ+gD6QPpA1DAH0z/6APpAMFFRoVJJxwXy4sEnwv/y4sKCCOThwKoAFqAWvPLiw4IQe92X3sjLHxXLP1AD+gIizxYBzxbJcYAYyMsFJM8WcPoCy2rMyYBA+wBAE8hQBPoCWM8WAc8WzMntVIACD1gCDXIe1E0PoA+kD6QNQwBNMfghAXjUUZUiC6ghB73ZfeE7oSsfLixdM/MfoAMBOgUCPIUAT6AljPFgHPFszJ7VSABug9gXaiaH0AfSB9IGoYfvPpPI='

export const JettonWalletOpCodes = {
    burn: 0x595f07bc,
    internalTransfer: 0x178d4519,
    transfer: 0xf8a7ea5,
    transferNotification: 0x7362d09c,
    excesses: 0xd53276db,

    burnNotification: 0x7bdd97de
}

export const JettonWalletErrors = {
    noErrors: 0,

    notBounceableOp: 200,

    notWorkchain: 333,
    notMasterchain: 334,

    notFromJettonMaster: 704,
    notFromOwner: 705,
    insufficientJettonBalance: 706,
    notFromJettonMasterOrOwner: 707,
    emptyForwardPayload: 708,
    insufficientMsgValue: 709,

    unknownOp: 0xffff,
}

export class JettonWallet implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new JettonWallet(address);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendTransfer(
        provider: ContractProvider,
        via: Sender,
        opts: {
            queryId?: number
            toAddress: Address
            fwdAmount: bigint
            jettonAmount: bigint
            fwdPayload?: Cell
        }
    ) {
        let body = beginCell()
            .storeUint(JettonWalletOpCodes.transfer, 32)
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
            value: toNano('0.05') + opts.fwdAmount,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: body.endCell()
        });
    }

    async getJettonBalance(provider: ContractProvider): Promise<bigint> {
        let state = await provider.getState();
        if (state.state.type !== 'active') {
            return 0n;
        }
        const res = await provider.get('get_wallet_data', []);
        return res.stack.readBigNumber();
    }
}
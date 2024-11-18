import { Blockchain, BlockchainSnapshot, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Cell, toNano } from '@ton/core';
import { Escrow } from '../wrappers/Escrow';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { Errors, Opcodes } from '../wrappers/constants';
import { JettonMinter, jettonMinterCode } from '../wrappers/JettonMinter';
import { JettonWallet, jettonWalletCode } from '../wrappers/JettonWallet';

const NEEDED_AMOUNT = toNano('10');
const GUARANTOR_ROYALTIES = 250;
const GUARANTOR_FEE = (NEEDED_AMOUNT * BigInt(GUARANTOR_ROYALTIES)) / 10000n;

describe('Escrow (TON payment)', () => {
    let code: Cell;
    let initialState: BlockchainSnapshot;
    let blockchain: Blockchain;
    let escrow: SandboxContract<Escrow>;
    let buyer: SandboxContract<TreasuryContract>;
    let seller: SandboxContract<TreasuryContract>;
    let guarantor: SandboxContract<TreasuryContract>;

    beforeAll(async () => {
        code = await compile('Escrow');


        blockchain = await Blockchain.create();

        buyer = await blockchain.treasury('buyer');
        seller = await blockchain.treasury('seller');
        guarantor = await blockchain.treasury('guarantor');

        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    jettonPayment: false,
                    dealId: 0n,
                    confirmationDuration: 10 * 60,
                    neededAmount: 0n,
                    buyer: buyer.address,
                    seller: seller.address,
                    guarantor: guarantor.address,
                    guarantorRoyalties: GUARANTOR_ROYALTIES
                }, 
                code
            )
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), NEEDED_AMOUNT, toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });

        expect((await escrow.getStorageData()).init).toBeTruthy()
        expect((await escrow.getStorageData()).neededAmount).toEqual(NEEDED_AMOUNT)

        initialState = blockchain.snapshot();
    });

    afterEach(async () => {
        await blockchain.loadFrom(initialState)
    });

    it('should deposit TON', async () => {
        blockchain.now = 1800000000;

        const depositResult = await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.deposit,
            value: NEEDED_AMOUNT
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: buyer.address,
            to: escrow.address,
            success: true,
            value: NEEDED_AMOUNT
        })

        expect((await escrow.getStorageData()).startTime).toEqual(1800000000);
    });

    it('should not deposit if sender is not buyer', async () => {
        const someone = await blockchain.treasury('someone');

        const depositResult = await escrow.sendMessage(someone.getSender(), {
            op: Opcodes.deposit,
            value: NEEDED_AMOUNT
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: someone.address,
            to: escrow.address,
            success: false,
            exitCode: Errors.wrong_sender,
            value: NEEDED_AMOUNT
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: someone.address,
            op: 0xffffffff
        })
        expect((await escrow.getStorageData()).startTime).toEqual(0);
    });

    it('should not deposit if msg_value is less than needed_amount', async () => {
        const depositResult = await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.deposit,
            value: toNano('1')
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: buyer.address,
            to: escrow.address,
            success: false,
            exitCode: Errors.insufficient_amount,
            value: toNano('1')
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: buyer.address,
            op: 0xffffffff,
            inMessageBounced: true
        })

        expect((await escrow.getStorageData()).startTime).toEqual(0);
    })

    it('should not deposit jettons if jetton_payment? is false', async () => {
        const jetton = blockchain.openContract(JettonMinter.createFromConfig({admin: buyer.address, content: new Cell(), jettonWalletCode: Cell.fromBase64(jettonWalletCode)}, Cell.fromBase64(jettonMinterCode)))
        await jetton.sendDeploy(buyer.getSender(), toNano('0.05'))
        await jetton.sendMint(buyer.getSender(), {
            toAddress: buyer.address,
            jettonAmount: toNano('100')
        })

        const buyerJettonWalletAddress = await jetton.getWalletAddress(buyer.address)
        const escrowJettonWalletAddress = await jetton.getWalletAddress(escrow.address)
        expect((await blockchain.getContract(buyerJettonWalletAddress)).accountState?.type === 'active')
        const buyerJettonWallet = blockchain.openContract(JettonWallet.createFromAddress(buyerJettonWalletAddress))

        const buyerJettonWalletBalanceBefore = await buyerJettonWallet.getJettonBalance()

        const depositResult = await buyerJettonWallet.sendTransfer(buyer.getSender(), {
            toAddress: escrow.address,
            jettonAmount: toNano('10'),
            fwdAmount: toNano('0.05')
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrowJettonWalletAddress,
            to: escrow.address,
            op: Opcodes.transfer_notification,
            success: true
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: escrowJettonWalletAddress,
            op: Opcodes.transfer,
            success: true
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrowJettonWalletAddress,
            to: buyerJettonWalletAddress,
            op: Opcodes.internal_transfer,
            success: true
        })

        const buyerJettonWalletBalanceAfter = await buyerJettonWallet.getJettonBalance()

        expect(buyerJettonWalletBalanceAfter).toEqual(buyerJettonWalletBalanceBefore)
        expect((await escrow.getStorageData()).startTime).toEqual(0)
    })

    it('should confirm deal', async () => {
        blockchain.now = 1800000000;
        
        await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.deposit,
            value: NEEDED_AMOUNT
        })

        blockchain.now = 1800000000 + 60;

        const confirmResult = await escrow.sendMessage(guarantor.getSender(), {
            op: Opcodes.confirm_deal,
            value: toNano('0.05')
        })

        expect(confirmResult.transactions).toHaveTransaction({
            from: guarantor.address,
            to: escrow.address,
            success: true,
            outMessagesCount: 3,
            destroyed: true
        })

        expect(confirmResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: seller.address,
            op: Opcodes.deal_succeeded_seller_notification,
            value: NEEDED_AMOUNT - GUARANTOR_FEE
        })

        expect(confirmResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: guarantor.address,
            op: Opcodes.deal_succeeded_guarantor_notification,
            value: GUARANTOR_FEE
        })

        expect(confirmResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: seller.address,
            op: Opcodes.excesses
        })

        expect((await blockchain.getContract(escrow.address)).accountState?.type === 'frozen')
    })

    it('should not confirm deal if sender is not guarantor', async () => {
        blockchain.now = 1800000000;
        
        await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.deposit,
            value: NEEDED_AMOUNT
        })

        blockchain.now = 1800000000 + 60;

        const confirmResult = await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.confirm_deal,
            value: toNano('0.05')
        })

        expect(confirmResult.transactions).toHaveTransaction({
            from: buyer.address,
            to: escrow.address, 
            success: false, 
            exitCode: Errors.wrong_sender
        })

        expect((await blockchain.getContract(escrow.address)).accountState?.type !== 'frozen')
    })

    it('should not confirm deal if confirmation deadline has occured', async () => {
        
        blockchain.now = 1800000000;
        
        await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.deposit,
            value: NEEDED_AMOUNT
        })

        blockchain.now = 1800000000 + 60 * 20;

        const confirmResult = await escrow.sendMessage(guarantor.getSender(), {
            op: Opcodes.confirm_deal,
            value: toNano('0.05')
        })

        expect(confirmResult.transactions).toHaveTransaction({
            from: guarantor.address,
            to: escrow.address, 
            success: false,
            exitCode: Errors.confirmation_deadline_has_occured            
        })

        expect((await blockchain.getContract(escrow.address)).accountState?.type !== 'frozen')
    })

    it('should reject deal', async () => {
        blockchain.now = 1800000000;
        
        await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.deposit,
            value: NEEDED_AMOUNT
        })

        blockchain.now = 1800000000 + 60;

        const rejectResult = await escrow.sendMessage(guarantor.getSender(), {
            op: Opcodes.reject_deal,
            value: toNano('0.05')
        })

        expect(rejectResult.transactions).toHaveTransaction({
            from: guarantor.address,
            to: escrow.address,
            success: true,
            outMessagesCount: 3,
            destroyed: true
        })

        expect(rejectResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: guarantor.address,
            op: Opcodes.deal_failed_guarantor_notification
        })

        expect(rejectResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: buyer.address,
            op: Opcodes.deal_failed_buyer_notification
        })

        expect(rejectResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: seller.address,
            op: Opcodes.deal_failed_seller_notification
        })

        expect((await blockchain.getContract(escrow.address)).accountState?.type === 'frozen')
    })

    it('should not reject deal if sender is not guarantor', async () => {
        blockchain.now = 1800000000;
        
        await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.deposit,
            value: NEEDED_AMOUNT
        })

        blockchain.now = 1800000000 + 60;

        const rejectResult = await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.reject_deal,
            value: toNano('0.05')
        })

        expect(rejectResult.transactions).toHaveTransaction({
            from: buyer.address,
            to: escrow.address,
            success: false,
            exitCode: Errors.wrong_sender
        })

        expect((await blockchain.getContract(escrow.address)).accountState?.type !== 'frozen')
    })

    it('should not reject deal if confirmation deadline has occured', async () => {
        
        blockchain.now = 1800000000;
        
        await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.deposit,
            value: NEEDED_AMOUNT
        })

        blockchain.now = 1800000000 + 60 * 20;

        const confirmResult = await escrow.sendMessage(guarantor.getSender(), {
            op: Opcodes.reject_deal,
            value: toNano('0.05')
        })

        expect(confirmResult.transactions).toHaveTransaction({
            from: guarantor.address,
            to: escrow.address, 
            success: false,
            exitCode: Errors.confirmation_deadline_has_occured          
        })

        expect((await blockchain.getContract(escrow.address)).accountState?.type !== 'frozen')
    })

    it('should refund', async () => {
        blockchain.now = 1800000000;
        
        await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.deposit,
            value: NEEDED_AMOUNT
        })

        blockchain.now = 1800000000 + 60 * 20;

        const refundResult = await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.refund,
            value: toNano('0.02')
        })

        expect(refundResult.transactions).toHaveTransaction({
            from: buyer.address,
            to: escrow.address,
            success: true,
            outMessagesCount: 2,
            destroyed: true
        })

        expect(refundResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: buyer.address,
            op: Opcodes.refund_notification,
            value: NEEDED_AMOUNT
        })

        expect(refundResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: seller.address,
            op: Opcodes.excesses,
        })

        expect((await blockchain.getContract(escrow.address)).accountState?.type === 'frozen')
    })

    it('should not refund if confirmation deadline has not occured yet', async () => {
        blockchain.now = 1800000000;
        
        await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.deposit,
            value: NEEDED_AMOUNT
        })

        blockchain.now = 1800000000 + 60;

        const refundResult = await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.refund,
            value: toNano('0.02')
        })

        expect(refundResult.transactions).toHaveTransaction({
            from: buyer.address,
            to: escrow.address,
            success: false,
            exitCode: Errors.confirmation_deadline_not_come_yet
        })

        expect((await blockchain.getContract(escrow.address)).accountState?.type !== 'frozen')
    })

    it('should throw exception if op code is unknown', async () => {
        const wrongOpResult = await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.some_unknown_op,
            value: toNano('0.05')
        })

        expect(wrongOpResult.transactions).toHaveTransaction({
            from: buyer.address,
            to: escrow.address,
            success: false,
            exitCode: Errors.unknown_op
        })
    })
});

const JETTON_TRANSFER_FEE = toNano('0.055');

describe('Escrow (Jetton payment)', () => {
    let code: Cell;
    let initialState: BlockchainSnapshot;
    let blockchain: Blockchain;
    let escrow: SandboxContract<Escrow>;
    let buyer: SandboxContract<TreasuryContract>;
    let seller: SandboxContract<TreasuryContract>;
    let guarantor: SandboxContract<TreasuryContract>;
    let jettonMinter: SandboxContract<JettonMinter>;
    let buyerJettonWallet: SandboxContract<JettonWallet>;
    let sellerJettonWallet: SandboxContract<JettonWallet>;

    let escrowJettonWalletAddress: Address;
    let jettonAdmin: SandboxContract<TreasuryContract>;

    beforeAll(async () => {
        code = await compile('Escrow');
        blockchain = await Blockchain.create();

        buyer = await blockchain.treasury('buyer');
        seller = await blockchain.treasury('seller');
        guarantor = await blockchain.treasury('guarantor');

        jettonAdmin = await blockchain.treasury('jettonAdmin');

        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    jettonPayment: true,
                    dealId: 0n,
                    confirmationDuration: 10 * 60,
                    neededAmount: 0n,
                    buyer: buyer.address,
                    seller: seller.address,
                    guarantor: guarantor.address,
                    guarantorRoyalties: GUARANTOR_ROYALTIES
                }, 
                code
            )
        );

        jettonMinter = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: jettonAdmin.address,
                    content: new Cell(),
                    jettonWalletCode: Cell.fromBase64(jettonWalletCode)
                },
                Cell.fromBase64(jettonMinterCode)
            )
        )

        await jettonMinter.sendDeploy(jettonAdmin.getSender(), toNano('0.05'))

        escrowJettonWalletAddress = await jettonMinter.getWalletAddress(escrow.address)
        const deployResult = await escrow.sendDeploy(seller.getSender(), NEEDED_AMOUNT, toNano('0.1'), escrowJettonWalletAddress);

        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });

        expect((await escrow.getStorageData()).init).toBeTruthy()
        expect((await escrow.getStorageData()).neededAmount).toEqual(NEEDED_AMOUNT)

        await jettonMinter.sendMint(jettonAdmin.getSender(), {
            toAddress: buyer.address,
            jettonAmount: toNano('100')
        })

        const buyerWalletAddress = await jettonMinter.getWalletAddress(buyer.address)
        expect((await blockchain.getContract(buyerWalletAddress)).accountState?.type === 'active')
        const sellerWalletAddress = await jettonMinter.getWalletAddress(seller.address)

        buyerJettonWallet = blockchain.openContract(JettonWallet.createFromAddress(buyerWalletAddress))
        expect(await buyerJettonWallet.getJettonBalance()).toEqual(toNano('100'))
        sellerJettonWallet = blockchain.openContract(JettonWallet.createFromAddress(sellerWalletAddress))
        initialState = blockchain.snapshot();
    });

    afterEach(async () => {
        await blockchain.loadFrom(initialState)
    });

    it('should deposit jettons', async () => {
        blockchain.now = 1800000000
        const depositResult = await buyerJettonWallet.sendTransfer(buyer.getSender(), {
            toAddress: escrow.address,
            jettonAmount: toNano('10'),
            fwdAmount: toNano('0.01')
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: buyer.address,
            to: buyerJettonWallet.address,
            op: Opcodes.transfer,
            success: true
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: buyerJettonWallet.address,
            to: escrowJettonWalletAddress,
            op: Opcodes.internal_transfer,
            success: true
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrowJettonWalletAddress,
            to: escrow.address,
            op: Opcodes.transfer_notification,
            success: true
        })

        expect((await escrow.getStorageData()).startTime).toEqual(1800000000)
    })

    it('should return jettons back if sender is not escrow jetton wallet', async () => {
        const randomJetton = blockchain.openContract(JettonMinter.createFromConfig({admin: buyer.address, content: new Cell(), jettonWalletCode: Cell.fromBase64(jettonWalletCode)}, Cell.fromBase64(jettonMinterCode)))
        await randomJetton.sendDeploy(buyer.getSender(), toNano('0.05'))
        await randomJetton.sendMint(buyer.getSender(), {
            toAddress: buyer.address,
            jettonAmount: toNano('100')
        })

        const buyerRandomJettonWalletAddress = await randomJetton.getWalletAddress(buyer.address)
        const escrowRandomJettonWalletAddress = await randomJetton.getWalletAddress(escrow.address)
        expect((await blockchain.getContract(buyerRandomJettonWalletAddress)).accountState?.type === 'active')
        const buyerRandomJettonWallet = blockchain.openContract(JettonWallet.createFromAddress(buyerRandomJettonWalletAddress))

        const buyerRandomJettonWalletBalanceBefore = await buyerRandomJettonWallet.getJettonBalance()

        const depositResult = await buyerRandomJettonWallet.sendTransfer(buyer.getSender(), {
            toAddress: escrow.address,
            jettonAmount: toNano('10'),
            fwdAmount: toNano('0.05')
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrowRandomJettonWalletAddress,
            to: escrow.address,
            op: Opcodes.transfer_notification,
            success: true
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: escrowRandomJettonWalletAddress,
            op: Opcodes.transfer,
            success: true
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrowRandomJettonWalletAddress,
            to: buyerRandomJettonWalletAddress,
            op: Opcodes.internal_transfer,
            success: true
        })

        const buyerRandomJettonWalletBalanceAfter = await buyerRandomJettonWallet.getJettonBalance()

        expect(buyerRandomJettonWalletBalanceAfter).toEqual(buyerRandomJettonWalletBalanceBefore)
        expect((await escrow.getStorageData()).startTime).toEqual(0)
    })

    it('should return jettons back if from_address is not equal to buyer address', async () => {
        const someone = await blockchain.treasury('someone')

        await jettonMinter.sendMint(jettonAdmin.getSender(), {
            toAddress: someone.address,
            jettonAmount: toNano('100')
        })

        const someoneJettonWalletAddress = await jettonMinter.getWalletAddress(someone.address)
        expect((await blockchain.getContract(someoneJettonWalletAddress)).accountState?.type === 'active')
        const someoneJettonWallet = blockchain.openContract(JettonWallet.createFromAddress(someoneJettonWalletAddress))

        const someoneJettonWalletBalanceBefore = await someoneJettonWallet.getJettonBalance()

        const depositResult = await someoneJettonWallet.sendTransfer(someone.getSender(), {
            toAddress: escrow.address,
            jettonAmount: toNano('10'),
            fwdAmount: toNano('0.05')
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrowJettonWalletAddress,
            to: escrow.address,
            op: Opcodes.transfer_notification,
            success: true
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: escrowJettonWalletAddress,
            op: Opcodes.transfer,
            success: true
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrowJettonWalletAddress,
            to: someoneJettonWalletAddress,
            op: Opcodes.internal_transfer,
            success: true
        })

        const someoneJettonWalletBalanceAfter = await someoneJettonWallet.getJettonBalance()

        expect(someoneJettonWalletBalanceAfter).toEqual(someoneJettonWalletBalanceBefore)
        expect((await escrow.getStorageData()).startTime).toEqual(0)
    })

    it('should return jettons back if jetton amount is less than needed amount', async () => {
        const buyerJettonWalletBalanceBefore = await buyerJettonWallet.getJettonBalance()

        const depositResult = await buyerJettonWallet.sendTransfer(buyer.getSender(), {
            toAddress: escrow.address,
            jettonAmount: toNano('5'),
            fwdAmount: toNano('0.05')
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrowJettonWalletAddress,
            to: escrow.address,
            op: Opcodes.transfer_notification,
            success: true
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: escrowJettonWalletAddress,
            op: Opcodes.transfer,
            success: true
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrowJettonWalletAddress,
            to: buyerJettonWallet.address,
            op: Opcodes.internal_transfer,
            success: true
        })

        const buyerJettonWalletBalanceAfter = await buyerJettonWallet.getJettonBalance()

        expect(buyerJettonWalletBalanceAfter).toEqual(buyerJettonWalletBalanceBefore)
        expect((await escrow.getStorageData()).startTime).toEqual(0)
    })

    it('should not deposit tons', async () => {
        const depositResult = await escrow.sendMessage(buyer.getSender(), {
            op: Opcodes.deposit,
            value: NEEDED_AMOUNT
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: buyer.address,
            to: escrow.address,
            success: false,
            value: NEEDED_AMOUNT,
            exitCode: Errors.jetton_payment_required
        })

        expect(depositResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: buyer.address,
            op: 0xffffffff
        })

        expect((await escrow.getStorageData()).startTime).toEqual(0);
    })

    it('should confirm deal', async () => {
        blockchain.now = 1800000000
        await buyerJettonWallet.sendTransfer(buyer.getSender(), {
            toAddress: escrow.address,
            jettonAmount: toNano('10'),
            fwdAmount: toNano('0.01')
        })

        blockchain.now = 1800000000 + 60;

        const confirmResult = await escrow.sendMessage(guarantor.getSender(), {
            op: Opcodes.confirm_deal,
            value: toNano('0.05')
        })

        expect(confirmResult.transactions).toHaveTransaction({
            from: guarantor.address,
            to: escrow.address,
            success: true,
            outMessagesCount: 3,
            destroyed: true
        })

        expect(confirmResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: escrowJettonWalletAddress,
            success: true,
            op: Opcodes.transfer,
            outMessagesCount: 1,
            value: JETTON_TRANSFER_FEE
        })

        expect(confirmResult.transactions).toHaveTransaction({
            from: escrowJettonWalletAddress,
            to: sellerJettonWallet.address,
            success: true,
            op: Opcodes.internal_transfer
        })

        const guarantorJettonWallet = blockchain.openContract(JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(guarantor.address)))

        expect(confirmResult.transactions).toHaveTransaction({
            from: escrowJettonWalletAddress,
            to: guarantorJettonWallet.address,
            success: true,
            op: Opcodes.internal_transfer
        })

        expect(confirmResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: seller.address,
            success: true,
            op: Opcodes.excesses
        })

        expect((await blockchain.getContract(escrow.address)).accountState?.type === 'frozen')
    })
    it('should refund', async () => {
        blockchain.now = 1800000000;

        await buyerJettonWallet.sendTransfer(buyer.getSender(), {
            toAddress: escrow.address,
            jettonAmount: toNano('10'),
            fwdAmount: toNano('0.01')
        })

        blockchain.now = 1800000000 + 10 * 60 + 1

        const refundResult = await escrow.sendMessage(buyer.getSender(), {
            value: toNano('0.05'),
            op: Opcodes.refund
        })

        expect(refundResult.transactions).toHaveTransaction({
            from: buyer.address,
            to: escrow.address,
            success: true,
            outMessagesCount: 2,
            destroyed: true
        })

        expect(refundResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: escrowJettonWalletAddress,
            success: true,
            outMessagesCount: 1,
            op: Opcodes.transfer,
            value: JETTON_TRANSFER_FEE
        })

        expect(refundResult.transactions).toHaveTransaction({
            from: escrowJettonWalletAddress,
            to: buyerJettonWallet.address,
            op: Opcodes.internal_transfer,
            success: true
        })

        expect(refundResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: seller.address,
            success: true,
            op: Opcodes.excesses,
        })

        expect((await blockchain.getContract(escrow.address)).accountState?.type === 'frozen')
    })
})
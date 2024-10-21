import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { Escrow } from '../wrappers/Escrow';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { Errors, Opcodes } from '../wrappers/constants';
import { jettonContentToCell, JettonMinter } from '../wrappers/JettonMinter';

const NEEDED_AMOUNT = toNano('10');
const GUARANTOR_ROYALTIES = 250;
const GUARANTOR_FEE = (NEEDED_AMOUNT * BigInt(GUARANTOR_ROYALTIES)) / 10000n;

describe('Escrow (TON payment)', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Escrow');
    });

    let blockchain: Blockchain;
    let escrow: SandboxContract<Escrow>;
    let buyer: SandboxContract<TreasuryContract>;
    let seller: SandboxContract<TreasuryContract>;
    let guarantor: SandboxContract<TreasuryContract>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        buyer = await blockchain.treasury('buyer');
        seller = await blockchain.treasury('seller');
        guarantor = await blockchain.treasury('guarantor');

        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    init: false,
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
            op: 0xffffffff,
            inMessageBounced: true
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

        printTransactionFees(confirmResult.transactions)
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

        printTransactionFees(rejectResult.transactions)

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

        printTransactionFees(rejectResult.transactions)

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

describe('Escrow (Jetton payment)', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Escrow');
    });

    let blockchain: Blockchain;
    let escrow: SandboxContract<Escrow>;
    let buyer: SandboxContract<TreasuryContract>;
    let seller: SandboxContract<TreasuryContract>;
    let guarantor: SandboxContract<TreasuryContract>;
    let jettonMinter: SandboxContract<JettonMinter>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        buyer = await blockchain.treasury('buyer');
        seller = await blockchain.treasury('seller');
        guarantor = await blockchain.treasury('guarantor');

        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    init: false,
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

        const jettonAdmin = await blockchain.treasury('jettonAdmin');

        jettonMinter = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: jettonAdmin.address,
                    content: jettonContentToCell('some-url'),
                    walletСode: await compile('JettonWallet')
                },
                await compile('JettonMinter')
            )
        )

        await jettonMinter.sendDeploy(jettonAdmin.getSender(), toNano('0.05'))

        const escrowJettonWalletAddress = await jettonMinter.getWalletAddress(escrow.address)
        const deployResult = await escrow.sendDeploy(seller.getSender(), NEEDED_AMOUNT, toNano('0.05'), escrowJettonWalletAddress);

        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });

        expect((await escrow.getStorageData()).init).toBeTruthy()
        expect((await escrow.getStorageData()).neededAmount).toEqual(NEEDED_AMOUNT)
    });

    it('should deposit jettons', async () => {
        
    })
})
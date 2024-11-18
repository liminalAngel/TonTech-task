export enum Opcodes {
    deposit = 0xf9471134,
    confirm_deal = 0x1dfc5e8f,
    reject_deal = 0x7ae0bdec,
    refund = 0xc135f40c,
    transfer = 0xf8a7ea5,
    internal_transfer = 0x178d4519,
    transfer_notification = 0x7362d09c,
    excesses = 0xd53276db,

    deal_succeeded_seller_notification = 0xcc4158fb,
    deal_succeeded_guarantor_notification = 0x28b554f5,
    deal_failed_guarantor_notification = 0x9d2e3bcd,
    deal_failed_seller_notification = 0xc07f109d,
    deal_failed_buyer_notification = 0x6b03123c,

    refund_notification = 0xf67efa32,

    some_unknown_op = 500
}

export enum Errors {
    wrong_sender = 111,
    insufficient_amount = 112,
    insufficient_balance = 113,
    insufficient_value_for_paying_fees = 114,
    confirmation_deadline_not_come_yet = 115,
    jetton_payment_required = 116,
    confirmation_deadline_has_occured = 117,
    unknown_op = 0xffff,
}
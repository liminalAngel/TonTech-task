# Escrow contract

## Overview
This smart contract facilitates secure and transparent escrow transactions involving a buyer, a seller, and a guarantor. It supports payments in TON and Jetton. The contract ensures the safe transfer of funds based on predefined conditions and timelines, mitigating disputes and risks.

### Storage Variables
- `storage::init?`: Indicates whether the contract has been initialized.
- `storage::jetton_payment?`: Specifies the payment method for the deal.
- `storage::deal_id`: Unique identifier for the escrow deal. Allows tracking and distinguishing deals.
- `storage::start_time`: Records the timestamp when the escrow process starts. Used to calculate deadlines for confirmation and refunds.
- `storage::confirmation_duration`: Specifies the duration during which the guarantor can confirm or reject the deal.
- `storage::needed_amount`: The total payment required to complete the deal. Ensures that the buyer transfers sufficient funds to the escrow contract.
- `storage::buyer`: The address of the buyer involved in the escrow deal.
- `storage::seller`: The address of the seller involved in the escrow deal.
- `storage::guarantor`: The address of the guarantor overseeing the deal.
- `storage::guarantor_royalties`: Specifies the percentage of the total payment allocated to the guarantor as a fee. Calculates the amount of the guarantor's fee during the deal confirmation process.
- `storage::escrow_jetton_wallet`: The Jetton wallet address used to hold escrowed funds (if Jetton payments are enabled).

#### TL-B scheme of storage
`_ init?:Bool jetton_payment?:Bool deal_id:uint64 start_time:uint32 confirmation_duration:uint32 needed_amount:Coins buyer:MsgAddressInt seller:MsgAddressInt guarantor:MsgAddressInt guarantor_royalties:uint10 escrow_jetton_wallet:MsgAddressInt = Storage;`

### Errors
   - `error::wrong_sender` (111): Triggered when the sender is unauthorized for a specific operation.
   - `error::jetton_payment_required` (116): Triggered when Jetton payment is required but not used.
   - `error::insufficient_amount` (112): Triggered when the payment amount sent is less than `storage::needed_amount`.
   - `error::confirmation_deadline_has_occured` (117): Triggered when the confirmation deadline has passed.
   - `error::insufficient_balance` (113): Triggered when the contract’s balance is insufficient to process fees or payments.
   - `error::confirmation_deadline_not_come_yet` (115): Triggered when an operation is attempted before the confirmation deadline.
   - `error::insufficient_value_for_paying_fees` (114): Triggered when insufficient TON is sent to cover gas fees.
   - `error::unknown_op` (0xffff): Triggered when an unsupported operation is attempted to invoke.

### Functionality
1. `op::transfer_notification`
   - Handles Jetton transfers to the escrow wallet.
   - Validates the transfer is from the correct Jetton wallet and sender.
   - Ensures the amount transferred matches or exceeds `storage::needed_amount`.
   - Updates the `storage::start_time` if validation succeeds.
   ##### TL-B scheme
   `transfer_notification#7362d09c query_id:uint64 amount:Coins from:MsgAddressInt forward_payload:(Either Cell ^Cell) = InternalMsgBody;`
    - `query_id`: A 64-bit unsigned integer serving as the unique identifier for the request.
    - `amount`: Amount of transferred jettons.
    - `from`: Address of the sender (transfer initiator).
    - `forward_payload`: Optional custom data that should be sent to the destination address.

2. `op::deposit`
   - Handles TON deposit from the buyer.
   - Validates that the payment is in TON.
   - Ensures the sender is the buyer and the amount matches or exceeds `storage::needed_amount`.
   - Updates the `storage::start_time` if validation succeeds.
   ##### TL-B scheme
   `deposit#f9471134 query_id:uint64 = InternalMsgBody;`
    - `query_id`: A 64-bit unsigned integer serving as the unique identifier for the request.

3. `op::confirm_deal`
   - Confirm the deal and distribute funds.
   - Validates the sender is the guarantor and the confirmation deadline has not passed.
   - Calculates the guarantor fee based on `storage::guarantor_royalties`.
   - Distributes the payment:
       - Sends `storage::needed_amount - guarantor_fee` to the seller.
       - Sends `guarantor_fee` to the guarantor, if applicable.
   - Returns excess funds to the seller.
   ##### TL-B scheme
   `confirm_deal#1dfc5e8f query_id:uint64 = InternalMsgBody;`
    - `query_id`: A 64-bit unsigned integer serving as the unique identifier for the request.

4. `op::reject_deal`
   - Reject the deal and refund the buyer.
   - Validates the sender is the guarantor and the confirmation deadline has not passed.
   - Sends a refund to the buyer.
   - Sends notifications to all parties (buyer, seller, and guarantor).
   ##### TL-B scheme
   `reject_deal#7ae0bdec query_id:uint64 = InternalMsgBody;`
    - `query_id`: A 64-bit unsigned integer serving as the unique identifier for the request.

5. `op::refund`
   - Refund the buyer after the confirmation deadline.
   - Ensures the confirmation deadline has passed.
   - Refunds the `storage::needed_amount` to the buyer.
   - Returns excess funds to the seller.
   ##### TL-B scheme
   `refund#c135f40c query_id:uint64 = InternalMsgBody;`
    - `query_id`: A 64-bit unsigned integer serving as the unique identifier for the request.

#### Get-methods
- `get_storage_data`
   Retrieves contract data.
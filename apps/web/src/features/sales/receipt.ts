import type { BranchDto, PublicSettingsDto, SaleDto } from '@shopstock/shared';

/** Everything a receipt shows comes from the STORED sale; settings only give the shop header and footer. */
export type ReceiptProps = {
  sale: SaleDto;
  branch: BranchDto;
  settings: PublicSettingsDto;
  copy: boolean;
};

/** Local date and time in the SHOP timezone (FR-IVC-02), whatever the browser's timezone is. */
export const receiptTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

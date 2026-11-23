// Fictional sample documents for the demo. All names and numbers are made up.
export const SAMPLES: Record<string, { label: string; text: string }> = {
  clinic: {
    label: 'Clinic letter',
    text: `Shibuya Minami Clinic
Patient: Wei Chen (DOB 1994-03-17)
Health insurance no. AB1234567
Phone: 090-1234-5678  Email: wei.chen@example.com

Dear Wei Chen,
Your blood test on 2026-11-02 showed an HbA1c of 6.4%, which is in the pre-diabetes range.
Dr. Keiko Sato recommends a follow-up visit within 4 weeks and a 75g oral glucose tolerance test.
Please bring your My Number card (1234 5678 9012) to reception. The co-payment is about 3,200 yen.
Fasting is required for 10 hours before the test. Reply to book: https://clinic.example.jp/book`,
  },
  lease: {
    label: 'Apartment lease notice',
    text: `NOTICE OF LEASE RENEWAL
To: Maria Santos, 〒150-0001 Tokyo, Shibuya-ku, Jingumae 1-2-3, Room 405
From: Sakura Home Management Co.

Your lease ends on 2027-01-31. To renew, return the signed form by 2026-12-15 and pay the renewal fee
(one month's rent, 98,000 yen) to account 1234567 at Mizuho Bank. A guarantor company review is required again.
If you plan to move out, give written notice at least one month before the end date.
Contact: Mr. Ken Tanaka, 03-5555-1234, k.tanaka@example.co.jp`,
  },
  hr: {
    label: 'HR email',
    text: `Hi Daniel Kim,
Following our call, your visa sponsorship paperwork is ready. Please confirm your passport number TK9876543
and home address (2-4-6 Nakameguro, Meguro-ku) by Friday. Your new salary of 7,200,000 yen applies from 2027-01-01.
Payroll will deposit to card 4111 1111 1111 1111 on file. Call me at +81 80-2222-3333 if anything is wrong.
Best, Aiko Mori, People Team`,
  },
};

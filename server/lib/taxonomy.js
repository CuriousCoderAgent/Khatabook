/**
 * The fixed top level. Subcategories underneath are free text — the classifier
 * is allowed to invent them (e.g. "Instamart", "office lunch", "school fees"),
 * which is how the tree grows without schema changes.
 */
export const CATEGORIES = [
  { key: "salary",    label: "Salary",              dir: "in",  group: "Income",    color: "#1C6A49", dash: "0" },
  { key: "reimb_in",  label: "Reimbursement in",    dir: "in",  group: "Income",    color: "#3E8E6B", dash: "6 3" },
  { key: "interest",  label: "Interest & dividend", dir: "in",  group: "Income",    color: "#72AD90", dash: "1 4" },
  { key: "other_in",  label: "Other income",        dir: "in",  group: "Income",    color: "#9CC4B1", dash: "9 3 2 3" },

  { key: "rent",      label: "Rent",                dir: "out", group: "Home",      color: "#4a3aa7", dash: "0" },
  { key: "household", label: "Household & bills",   dir: "out", group: "Home",      color: "#008300", dash: "0" },
  { key: "help",      label: "Domestic help",       dir: "out", group: "Home",      color: "#1baf7a", dash: "6 3" },
  { key: "groceries", label: "Groceries",           dir: "out", group: "Food",      color: "#4a3aa7", dash: "6 3" },
  { key: "delivery",  label: "Food delivery",       dir: "out", group: "Food",      color: "#2a78d6", dash: "6 3" },
  { key: "dining",    label: "Dining out",          dir: "out", group: "Food",      color: "#1baf7a", dash: "0" },
  { key: "commute",   label: "Commute & fuel",      dir: "out", group: "Movement",  color: "#eda100", dash: "6 3" },
  { key: "cabs",      label: "Cabs & rides",        dir: "out", group: "Movement",  color: "#e34948", dash: "6 3" },
  { key: "travel",    label: "Travel & stays",      dir: "out", group: "Movement",  color: "#2a78d6", dash: "0" },
  { key: "shopping",  label: "Shopping",            dir: "out", group: "Lifestyle", color: "#e34948", dash: "0" },
  { key: "subs",      label: "Subscriptions",       dir: "out", group: "Lifestyle", color: "#2a78d6", dash: "1 4" },
  { key: "personal",  label: "Personal care",       dir: "out", group: "Lifestyle", color: "#4a3aa7", dash: "1 4" },
  { key: "health",    label: "Health & medical",    dir: "out", group: "Care",      color: "#008300", dash: "6 3" },
  { key: "insurance", label: "Insurance",           dir: "out", group: "Care",      color: "#eda100", dash: "1 4" },
  { key: "education", label: "Education & kids",    dir: "out", group: "Care",      color: "#e34948", dash: "1 4" },
  { key: "gifts",     label: "Gifts",               dir: "out", group: "People",    color: "#1baf7a", dash: "1 4" },
  { key: "family",    label: "Family transfer",     dir: "out", group: "People",    color: "#008300", dash: "1 4" },
  { key: "charity",   label: "Charity & donation",  dir: "out", group: "People",    color: "#2a78d6", dash: "9 3 2 3" },
  { key: "emi",       label: "EMI & loans",         dir: "out", group: "Money",     color: "#eda100", dash: "0" },
  // A car or personal loan EMI stays under `emi` above: it buys a depreciating
  // thing, or nothing at all, and is spending. A home loan is the one that
  // leaves an asset behind, so it sits with the investments instead — see the
  // note on `principal` in db/schema.sql for the half of it that does not.
  { key: "fees",      label: "Fees & charges",      dir: "out", group: "Money",     color: "#4a3aa7", dash: "9 3 2 3" },
  { key: "tax",       label: "Tax",                 dir: "out", group: "Money",     color: "#e34948", dash: "9 3 2 3" },
  { key: "cash",      label: "Cash withdrawal",     dir: "out", group: "Money",     color: "#eda100", dash: "9 3 2 3" },
  { key: "misc",      label: "Uncategorised",       dir: "out", group: "Money",     color: "#1baf7a", dash: "9 3 2 3" },

  // Money moves both ways through these three. A broker payout, a card refund
  // and a transfer back from your own account are all `in` rows, and none of
  // them are income. `dir` is the usual direction; `both` says the other one is
  // legal too, which is what keeps them out of both totals either way.
  { key: "invest",    label: "Investment out",      dir: "out", group: "Invested",  color: "#7A8B7F", dash: "0", both: true },
  // Same hue as `invest` on purpose — they are the same kind of money and the
  // dash is what tells the two lines apart, as everywhere past the sixth hue.
  { key: "home_loan", label: "Home loan EMI",       dir: "out", group: "Invested",  color: "#7A8B7F", dash: "9 3 2 3", both: true },
  { key: "cc_pay",    label: "Card bill payment",   dir: "out", group: "Transfer",  color: "#9BA8A0", dash: "6 3", both: true },
  { key: "self",      label: "Self transfer",       dir: "out", group: "Transfer",  color: "#B0BAB4", dash: "1 4", both: true },
];

export const CAT_KEYS = CATEGORIES.map(c => c.key);
/** Categories that may carry either direction. Never spending, never income. */
export const TRANSFER_KEYS = CATEGORIES.filter(c => c.both).map(c => c.key);
/** Is this category legal on a row going this way? */
export const dirAllowed = (key, direction) => {
  const c = CATEGORIES.find(x => x.key === key);
  return Boolean(c) && (c.both === true || c.dir === direction);
};
export const SCOPES = ["personal", "household", "official"];

/** Keyword fallbacks. Run when there is no learned memory and no AI key. */
export const KEYWORD_RULES = [
  ["instamart", "groceries", "Instamart"], ["blinkit", "groceries", "Blinkit"],
  ["zepto", "groceries", "Zepto"], ["bigbasket", "groceries", "BigBasket"],
  ["dmart", "groceries", "DMart"], ["jiomart", "groceries", "JioMart"],
  ["reliance fresh", "groceries", null], ["licious", "groceries", "meat"],
  ["swiggy", "delivery", "Swiggy"], ["zomato", "delivery", "Zomato"],
  ["dominos", "delivery", null], ["eatfit", "delivery", null],
  ["restaurant", "dining", null], ["cafe", "dining", null], ["barbeque", "dining", null],
  ["brewery", "dining", null], ["brewpub", "dining", null], ["starbucks", "dining", "coffee"],
  ["bistro", "dining", null], ["pizzeria", "dining", null], ["dhaba", "dining", null],
  ["uber", "cabs", "Uber"], ["olacabs", "cabs", "Ola"], ["rapido", "cabs", "Rapido"],
  ["namma yatri", "cabs", null],
  ["fastag", "commute", "tolls"], ["petrol", "commute", "fuel"], ["fuel", "commute", "fuel"],
  ["iocl", "commute", "fuel"], ["bpcl", "commute", "fuel"], ["hpcl", "commute", "fuel"],
  ["indian oil", "commute", "fuel"], ["metro", "commute", null], ["parking", "commute", "parking"],
  ["irctc", "travel", "rail"], ["indigo", "travel", "flights"], ["spicejet", "travel", "flights"],
  ["air india", "travel", "flights"], ["vistara", "travel", "flights"], ["akasa", "travel", "flights"],
  ["makemytrip", "travel", null], ["goibibo", "travel", null], ["cleartrip", "travel", null],
  ["oyo", "travel", "stays"], ["airbnb", "travel", "stays"], ["booking.com", "travel", "stays"],
  ["amazon", "shopping", "Amazon"], ["flipkart", "shopping", "Flipkart"], ["myntra", "shopping", "clothing"],
  ["ajio", "shopping", "clothing"], ["nykaa", "shopping", "beauty"], ["croma", "shopping", "electronics"],
  ["decathlon", "shopping", "sport"], ["ikea", "shopping", "home"],
  ["netflix", "subs", "streaming"], ["spotify", "subs", "music"], ["hotstar", "subs", "streaming"],
  ["prime video", "subs", "streaming"], ["youtube", "subs", "streaming"], ["apple.com", "subs", "Apple"],
  ["google one", "subs", "cloud"], ["icloud", "subs", "cloud"], ["adobe", "subs", "software"],
  ["openai", "subs", "software"], ["anthropic", "subs", "software"],
  ["electricity", "household", "electricity"], ["bescom", "household", "electricity"],
  ["adani elec", "household", "electricity"], ["torrent power", "household", "electricity"],
  ["water bill", "household", "water"], ["indane", "household", "gas"], ["bharat gas", "household", "gas"],
  ["broadband", "household", "internet"], ["act fibernet", "household", "internet"],
  ["airtel", "household", "telecom"], ["vodafone", "household", "telecom"], ["tata play", "household", "dth"],
  ["maintenance", "household", "society"], ["society", "household", "society"],
  ["rent", "rent", null], ["landlord", "rent", null],
  ["apollo", "health", "pharmacy"], ["pharmeasy", "health", "pharmacy"], ["netmeds", "health", "pharmacy"],
  ["1mg", "health", "pharmacy"], ["practo", "health", "consult"], ["hospital", "health", "hospital"],
  ["clinic", "health", "consult"], ["diagnostic", "health", "tests"],
  ["insurance", "insurance", null], ["policybazaar", "insurance", null], ["hdfc ergo", "insurance", null],
  ["school", "education", "school fees"], ["tuition", "education", "tuition"],
  ["byju", "education", null], ["unacademy", "education", null], ["coursera", "education", "courses"],
  ["salon", "personal", "salon"], ["gym", "personal", "fitness"], ["cult.fit", "personal", "fitness"],
  ["zerodha", "invest", "equity"], ["groww", "invest", "equity"], ["upstox", "invest", "equity"],
  ["kite", "invest", "equity"], ["angel one", "invest", "equity"], ["mutual fund", "invest", "mutual fund"],
  ["nps", "invest", "NPS"], ["ppf", "invest", "PPF"], ["elss", "invest", "ELSS"],
  ["indmoney", "invest", "INDmoney"], ["ind money", "invest", "INDmoney"],
  ["indwealth", "invest", "INDmoney"], ["smallcase", "invest", "smallcase"],
  ["coin by zerodha", "invest", "mutual fund"], ["kuvera", "invest", "mutual fund"],
  ["zerodha broking", "invest", "equity"], ["icici direct", "invest", "equity"],
  ["hdfc securities", "invest", "equity"], ["kotak securities", "invest", "equity"],
  ["motilal oswal", "invest", "equity"], ["sip ", "invest", "SIP"],
  // Ahead of the generic loan rules below, which would otherwise swallow these:
  // "home loan emi" contains "emi", and every one of them contains "loan".
  ["home loan", "home_loan", null], ["housing finance", "home_loan", null],
  ["hdfc ltd housing", "home_loan", null], ["bank ltd housing", "home_loan", null],
  ["housing dev", "home_loan", null], ["lic housing", "home_loan", null],
  ["housing loan", "home_loan", null],
  ["emi", "emi", null], ["loan", "emi", null],
  ["credit card payment", "cc_pay", null], ["card payment", "cc_pay", null],
  ["diners", "cc_pay", "Diners"], ["atm", "cash", null], ["cash wdl", "cash", null],
  ["p2a-father", "family", null], ["p2a-mother", "family", null],
  ["gift", "gifts", null], ["ferns", "gifts", "flowers"], ["archies", "gifts", null],
  ["gst", "fees", "tax"], ["charges", "fees", null], ["annual fee", "fees", null],
  ["salary", "salary", null], ["payroll", "salary", null],
  ["reimb", "reimb_in", null], ["expense claim", "reimb_in", null],
  ["interest credited", "interest", null], ["dividend", "interest", "dividend"],
];

const CAT_BY_KEY = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

export function keywordGuess(desc, direction) {
  const d = (desc || "").toLowerCase();
  for (const [kw, cat, sub] of KEYWORD_RULES) {
    if (!d.includes(kw)) continue;
    const c = CAT_BY_KEY[cat];
    if (!c || c.dir !== direction) continue;
    return { category: cat, subcategory: sub, confidence: 0.6, reason: `matched "${kw}"` };
  }
  return { category: direction === "in" ? "other_in" : "misc", subcategory: null, confidence: 0.2, reason: "no rule matched" };
}

/** Strip dates, refs and city noise so the same merchant collapses to one token. */
export function normaliseMerchant(desc) {
  return (desc || "")
    .toLowerCase()
    .replace(/\b\d{2}[-/]\d{2}[-/]\d{2,4}\b/g, " ")
    .replace(/\b(upi|neft|imps|rtgs|pos|atw|ach|mmt|ecs|nach|vps|inb)\b/g, " ")
    .replace(/\b[a-z0-9]{10,}\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(w => w.length > 2)
    .slice(0, 4)
    .join(" ");
}

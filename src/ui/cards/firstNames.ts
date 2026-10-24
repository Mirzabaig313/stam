// Common first names and the gender they are usually given, in English and in the Latin and
// Arabic-script spellings of Urdu, Arabic and Persian names. Loaded with import() when the add
// editor first opens (see genderFromName.ts), so it is not part of the app's first load.
// Names used for both are left out: they guess nothing, and the side panel says what was chosen.

const MALE_LATIN = `
aaron abbas abdul abdullah abdulrahman abdurrahman abid abrar adam adeel adil adnan afzal ahmad
ahmed ahsan aitzaz akbar akram ali altaf amaan amanullah amar amir amjad ammar anas anees anwar
aqeel arif arsalan arshad asad asghar ashfaq ashraf asif aslam atif ayaan ayub azam azhar aziz
babar bashir basit bilal danish dawood dawud ehsan ejaz fahad fahim faisal faraz farhan farooq
faruq fawad fazal feroz habib hadi hafiz haider hamid hamza hanif haris haroon harun hasan
hassan hussain husain ibrahim idris ijaz ilyas imran inayat irfan isa ishaq ismail jabbar jafar
jalal jamal jamil javed jawad junaid kabir kaleem kamal kamran karim kashif khalid khalil
khurram majid malik mansoor masood mehdi mehmood mohammad mohammed mohsin moin mubashir mudassar
muhammad mujahid mukhtar munir murtaza musa mustafa muzammil nabeel nadeem naeem nasir naveed
nawaz nazir noman obaid omar osama owais qadir qasim rafiq rahim rahman rashid rauf rayan rehan
rizwan saad sabir saddam sadiq saeed safdar sajid salahuddin salim salman sami samir saqib
sarfraz shafiq shahbaz shahid shahzad shakeel shan sharif shoaib siddiq sohail suleman sulaiman
sultan tahir talha tanveer tariq tauseef tayyab umair umar usama usman uzair wahab waleed waqar
waqas wasim yahya yaqoob yaqub yasir younis yousaf yusuf zafar zahid zaid zain zakariya zaki
zeeshan zia ziad zubair
adrian alan albert alexander alfred andrew anthony arthur benjamin brian bruce carl charles
christopher colin daniel david dennis donald douglas edward eric ernest eugene francis frank
frederick gary george gerald gordon graham gregory harold harry henry howard hugh ian jack jacob
james jason jeffrey jeremy john jonathan joseph joshua keith kenneth kevin lawrence leonard
liam louis lucas mark martin matthew michael nathan neil nicholas noah oliver oscar patrick
paul peter philip raymond richard robert roger ronald roy samuel scott simon stephen steven
stuart thomas timothy victor walter william
`;

const FEMALE_LATIN = `
aaliyah abida afia afshan aisha ayesha aiza alia aliya amara amber ambreen amina aminah amna
anam aneela anila aneesa anisa anum aqsa areeba arifa arooj asma asiya atiya ayat bano bushra
dua erum fahmida faiza fakhra farah fareeha farhana fariha farida faryal fatima fatimah fauzia
fiza fozia ghazala gulnaz hafsa hajra hamida hania hina huma humaira iqra iram irum jamila
javeria kanwal kausar khadija khalida kiran kulsoom laiba laila lubna madiha mahnoor maham
maira maleeha marium maryam mehwish mehreen misbah mona munira nabila nadia nafisa naila
najma nargis nasreen naseem nazia nida nighat nimra noreen nusrat parveen raheela rabia rafia
rahima raja rashida rehana rida rizwana robina rubina ruqaiya rukhsana saba sabeen sabiha sadaf
sadia safia saima sakina salma samina samira sana saniya sara sarah shabana shabnam shagufta
shahida shaista shakila shamim shazia shehnaz shireen sidra sobia sumaira sumaiya sundas
tabassum tahira tahmina tanzeela tayyaba uzma wajiha yasmin yasmeen zahida zahra zainab
zarina zeba zehra zoya zubaida zulekha zuleikha raje
abigail alice alison amanda amy angela ann anna anne barbara betty carol caroline catherine
charlotte christine claire deborah diana dorothy elizabeth ella emily emma evelyn florence
grace hannah helen isabella jane janet jennifer jessica joan judith julia karen katherine
laura linda lisa louise lucy margaret maria marie martha mary megan melissa michelle mia
nancy natalie olivia patricia rachel rebecca rose ruth sandra sharon sophia sophie susan
victoria
`;

const MALE_ARABIC = `
محمد احمد علی حسن حسین عمر عثمان ابراہیم اسماعیل اسحاق یعقوب یوسف موسیٰ عیسیٰ داؤد سلیمان حیدر
عبداللہ عبدالرحمن بلال حمزہ طلحہ زبیر خالد طارق عامر عادل عارف آصف اسلم اکرم انور بشیر جاوید
جمیل رشید سعید شاہد ظفر فیصل قاسم کامران مجید منیر نوید یاسر زاہد شریف رحیم کریم
محمّد أحمد علي حسن حسين عمر عثمان إبراهيم إسماعيل إسحاق يعقوب يوسف موسى عيسى داود سليمان
عبدالله عبدالرحمن بلال حمزة طلحة الزبير خالد طارق عامر عادل
`;

const FEMALE_ARABIC = `
فاطمہ عائشہ خدیجہ زینب مریم آمنہ حفصہ رقیہ سکینہ صفیہ زہرا شریفہ نسرین راجے بانو ثمینہ
شازیہ صائمہ صبا سعدیہ نادیہ نازیہ رابعہ عظمیٰ کوثر پروین شبنم حنا ہما بشریٰ ثناء سارہ
فاطمة عائشة خديجة زينب مريم آمنة حفصة رقية سكينة صفية زهراء نادية سارة هدى نور
`;

const words = (list: string) => list.split(/\s+/).filter(Boolean);

/** First name, normalised as `genderFromName` normalises it, to the gender it usually has. */
export const FIRST_NAMES: ReadonlyMap<string, "male" | "female"> = new Map([
  ...words(MALE_LATIN).map((n) => [n, "male"] as const),
  ...words(MALE_ARABIC).map((n) => [n, "male"] as const),
  ...words(FEMALE_LATIN).map((n) => [n, "female"] as const),
  ...words(FEMALE_ARABIC).map((n) => [n, "female"] as const),
]);

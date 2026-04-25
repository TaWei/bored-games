// ============================================================
// CODENAMES: WORD SPY GAME ENGINE
// ============================================================
//
// Game Overview:
//   - Two teams (Red & Blue), each with one Spymaster and rest Operatives
//   - 5x5 grid of codename words; each card is Red, Blue, Bystander, or Assassin
//   - Red has 9 agents, Blue has 8, 7 Innocents, 1 Assassin
//   - Spymaster gives one-word clues + a number (how many cards the clue covers)
//   - Operatives guess up to (number + 1) cards; can pass at any time
//   - Correct agent → card revealed, keep guessing
//   - Innocent bystander → turn ends, other team starts
//   - Opposing team's agent → opposing team gets the card, turn ends, other team starts
//   - Assassin → instant loss for the team that revealed it
//   - First team to find all 9 of their agents wins
//
// Game state phases:
//   waiting → role_assignment → clue_given → guessing → resolution → [clue_given or game_end]
//
// Codenames uses a server-side only model — client receives derived state via WS events
// ============================================================

import type { GameEngine } from './types';
import type {
	CodenamesState,
	CodenamesMove,
	CodenamesCard,
	CodenamesCardType,
	CodenamesTeam,
	CodenamesPlayerState,
	MoveResult,
	GameEnd,
} from '../types';

// ----- Word list -----
// Curated list of common, unambiguous nouns suitable for Codenames
const WORDS: string[] = [
	'AFRICA', 'AGENT', 'AIR', 'ALASKA', 'ALCOHOL', 'ALIBI', 'ALLEY', 'ALPS', 'AMAZON', 'ANGEL',
	'ANGER', 'ANTARCTICA', 'ANT', 'APPLE', 'ARM', 'AUSTRALIA', 'AWARD', 'AXE', 'BABY', 'BACK',
	'BALL', 'BAND', 'BANK', 'BARK', 'BAT', 'BATTERY', 'BEACH', 'BEAR', 'BEAT', 'BED',
	'BEIJING', 'BELL', 'BELT', 'BERLIN', 'BERYLLIUM', 'BILL', 'BLADE', 'BLIND', 'BLOCK', 'BLOOD',
	'BOARD', 'BOAT', 'BOMB', 'BOND', 'BONE', 'BOOK', 'BOOT', 'BOTTLE', 'BOW', 'BOWL',
	'BOX', 'BRASS', 'BRAZIL', 'BREAD', 'BREAK', 'BREED', 'BRICK', 'BRIDGE', 'BRITISH', 'BROADWAY',
	'BROWN', 'BRUSH', 'BUCKET', 'BUG', 'BUGLE', 'BULL', 'BUMPER', 'BUTTON', 'CABLE', 'CAKE',
	'CALIFORNIA', 'CALL', 'CAMEL', 'CAMP', 'CANADA', 'CANDLE', 'CANE', 'CAP', 'CAPITAL', 'CAR',
	'CARBON', 'CARD', 'CARGO', 'CARPET', 'CARROT', 'CART', 'CASE', 'CAST', 'CAT', 'CATCH',
	'CELLO', 'CHAIN', 'CHAIR', 'CHALK', 'CHAMPION', 'CHANGE', 'CHARGE', 'CHARM', 'CHART', 'CHASE',
	'CHEESE', 'CHESS', 'CHICAGO', 'CHICKEN', 'CHILD', 'CHINA', 'CHIRP', 'CHOCOLATE', 'CHORD', 'CHRISTMAS',
	'CHURCH', 'CIGAR', 'CIRCUS', 'CITY', 'CLAMP', 'CLASH', 'CLASS', 'CLAW', 'CLAY', 'CLIFF',
	'CLOCK', 'CLONE', 'CLOSE', 'CLOTH', 'CLOUD', 'CLUB', 'CLUE', 'CLUSTER', 'COAST', 'COAT',
	'COCONUT', 'CODE', 'COFFEE', 'COIL', 'COLA', 'COLD', 'COLLEGE', 'COLONIAL', 'COLOR', 'COMET',
	'COMIC', 'COMPOUND', 'COMPUTER', 'CONCERT', 'CONE', 'COTTON', 'COURT', 'COVER', 'COW', 'CRACK',
	'CRANE', 'CRASH', 'CRAWL', 'CRAYON', 'CRAZY', 'CREAM', 'CREATURE', 'CREEK', 'CREW', 'CRIME',
	'CROSS', 'CROWD', 'CROWN', 'CRUSH', 'CUBE', 'CURTAIN', 'CYCLE', 'CYLINDER', 'CZECH', 'DAIRY',
	'DANCE', 'DANGER', 'DASH', 'DAUGHTER', 'DAY', 'DEBRIS', 'DECK', 'DEGREE', 'DELAY', 'DENSE',
	'DESERT', 'DESK', 'DETECTIVE', 'DIAMOND', 'DIET', 'DIRTY', 'DISC', 'DISEASE', 'DISK', 'DIVIDE',
	'DOCTOR', 'DODGE', 'DOG', 'DOLLAR', 'DOLPHIN', 'DONKEY', 'DOOR', 'DOUBLE', 'DRAFT', 'DRAGON',
	'DRAIN', 'DRAMA', 'DRAW', 'DRAWER', 'DREAD', 'DREAM', 'DRESS', 'DRILL', 'DRINK', 'DRIVE',
	'DROP', 'DRUG', 'DRUM', 'DRY', 'DUCHESS', 'DUCK', 'DUMP', 'DUST', 'DYNASTY', 'EAGLE',
	'EAR', 'EARTH', 'EAT', 'EDGE', 'EGG', 'EGYPT', 'ELECTRIC', 'ELEPHANT', 'EMPIRE', 'EMPLOYEE',
	'ENERGY', 'ENGLAND', 'ESCAPE', 'EUROPE', 'EVIL', 'EXHIBIT', 'EXIT', 'EXPERT', 'EYE', 'FACE',
	'FACTORY', 'FALL', 'FAME', 'FAMILY', 'FAN', 'FANCY', 'FARM', 'FAST', 'FATHER', 'FAVOR',
	'FEAR', 'FEAST', 'FEED', 'FEET', 'FELT', 'FENCE', 'FERRY', 'FEVER', 'FIBER', 'FIELD',
	'FIGHTER', 'FIGURE', 'FILE', 'FILL', 'FILM', 'FILTER', 'FINAL', 'FINE', 'FIRE', 'FIRM',
	'FIRST', 'FISH', 'FIT', 'FIX', 'FLAG', 'FLAME', 'FLAP', 'FLARE', 'FLASH', 'FLASK',
	'FLESH', 'FLIES', 'FLOAT', 'FLOOD', 'FLOOR', 'FLORA', 'FLOWER', 'FLUID', 'FLUTE', 'FLY',
	'FOAM', 'FOCUS', 'FOG', 'FOLD', 'FOLK', 'FOOD', 'FOOT', 'FORCE', 'FOREST', 'FORGE',
	'FORK', 'FORM', 'FORT', 'FORTH', 'FORTUNE', 'FORUM', 'FOSSIL', 'FOUNTAIN', 'FOX', 'FRAME',
	'FRANCE', 'FREAK', 'FREEZE', 'FRENCH', 'FREQUENCY', 'FRESH', 'FRIAR', 'FRICTION', 'FRIEND', 'FROG',
	'FRONT', 'FROST', 'FRUIT', 'FUEL', 'FULL', 'FUNGUS', 'FURNITURE', 'GALAXY', 'GALLON', 'GAME',
	'GARAGE', 'GARLIC', 'GAS', 'GATE', 'GAUGE', 'GAZE', 'GENIUS', 'GERMANY', 'GHOST', 'GIANT',
	'GIRL', 'GLASS', 'GLOBE', 'GLORY', 'GLOVE', 'GOAT', 'GOLD', 'GOLF', 'GOOSE', 'GORGE',
	'GOVERNMENT', 'GRAB', 'GRADE', 'GRAIN', 'GRAND', 'GRAPE', 'GRAPH', 'GRASS', 'GRAVITY', 'GREAT',
	'GREEN', 'GRID', 'GRIEF', 'GRILL', 'GRIND', 'GROSS', 'GROUP', 'GROWTH', 'GUARD', 'GUESS',
	'GUEST', 'GUIDE', 'GUILT', 'GUITAR', 'GUN', 'GYM', 'HABIT', 'HAIR', 'HALF', 'HALL',
	'HAMMER', 'HAND', 'HARBOR', 'HARDWARE', 'HARM', 'HASH', 'HAT', 'HAWK', 'HEAD', 'HEALTH',
	'HEART', 'HEAVY', 'HELICOPTER', 'HELMET', 'HELP', 'HEMP', 'HERO', 'HILL', 'HINT', 'HOBBY',
	'HOCKEY', 'HOG', 'HOLE', 'HOLIDAY', 'HOLLOW', 'HOLLYWOOD', 'HOME', 'HONEY', 'HOOD', 'HOOK',
	'HOPE', 'HORN', 'HORSE', 'HOSPITAL', 'HOT', 'HOTEL', 'HOUR', 'HOUSE', 'HUMAN', 'HUMOR',
	'HURDLE', 'HUSKY', 'ICE', 'ICE CREAM', 'IDEAL', 'IMAGE', 'INDEX', 'INDIA', 'INDUSTRY',
	'INFLUENCE', 'INJECTION', 'INSECT', 'INSTINCT', 'INTELLIGENCE', 'INVENTION', 'IRON', 'ISLAND', 'ISSUE', 'IVORY',
	'JACKET', 'JAGUAR', 'JAIL', 'JAM', 'JAR', 'JAZZ', 'JELLY', 'JEWEL', 'JOINT', 'JOKE',
	'JOLLY', 'JUDGE', 'JUMP', 'JUNCTION', 'JUNGLE', 'JUPITER', 'JURY', 'KANGAROO', 'KAYAK', 'KETCHUP',
	'KEY', 'KICK', 'KILL', 'KIND', 'KING', 'KIWI', 'KNIFE', 'KNIGHT', 'KNOT', 'KNOWLEDGE',
	'LAB', 'LABEL', 'LABOR', 'LACE', 'LACK', 'LADDER', 'LAKE', 'LAMP', 'LAND', 'LANE',
	'LAP', 'LASER', 'LATCH', 'LAUGH', 'LAUNCH', 'LAVA', 'LAWN', 'LAWYER', 'LAYER', 'LEAD',
	'LEAF', 'LEAK', 'LEAP', 'LEATHER', 'LEFT', 'LEG', 'LEMON', 'LEVEL', 'LEVER', 'LIBERTY',
	'LIBRARY', 'LIE', 'LIFETIME', 'LIGHT', 'LILAC', 'LIMIT', 'LINE', 'LINK', 'LION', 'LIP',
	'LIST', 'LITERATURE', 'LOAD', 'LOAF', 'LOBBY', 'LOCAL', 'LOCK', 'LOCUST', 'LOG', 'LONDON',
	'LONG', 'LOOK', 'LOOP', 'LOOSE', 'LORRY', 'LOTUS', 'LOUD', 'LOUNGE', 'LOVE', 'LOW',
	'LOYALTY', 'LUCK', 'LUMBER', 'LUNCH', 'LUNGS', 'LYING', 'LYNX', 'LYRIC', 'MACHO', 'MACHINE',
	'MADE', 'MAGAZINE', 'MAGIC', 'MAGNET', 'MAID', 'MAIL', 'MAJOR', 'MAKEUP', 'MALE', 'MALL',
	'MAMMAL', 'MAN', 'MANAGER', 'MANSION', 'MAP', 'MARCH', 'MARRY', 'MARSH', 'MASK', 'MASS',
	'MATCH', 'MATTER', 'MAXIMUM', 'MAY', 'MAZE', 'MEADOW', 'MEAL', 'MEAN', 'MEASURE', 'MEAT',
	'MECHANISM', 'MEDAL', 'MEDIA', 'MEDICINE', 'MELON', 'MERCURY', 'MESSAGE', 'METAL', 'METER', 'METHOD',
	'MEXICO', 'MICROSCOPE', 'MIDDLE', 'MIDNIGHT', 'MIDWEST', 'MIGHT', 'MILE', 'MILITARY', 'MILK', 'MILL',
	'MILLION', 'MIND', 'MINE', 'MINERAL', 'MINOR', 'MINT', 'MINUTE', 'MISS', 'MISSILE', 'MODEL',
	'MODEM', 'MODERN', 'MOISTURE', 'MONEY', 'MONKEY', 'MONTH', 'MOON', 'MOP', 'MORAL', 'MOSCOW',
	'MOUNT', 'MOUNTAIN', 'MOUSE', 'MOUTH', 'MOVE', 'MOVEMENT', 'MUCH', 'MUD', 'MUG', 'MUSIC',
	'MUSTARD', 'MYSTERY', 'MYTH', 'NAIL', 'NAME', 'NATION', 'NATIVE', 'NATURAL', 'NATURE', 'NEED',
	'NEON', 'NERVE', 'NET', 'NEUTRAL', 'NEVER', 'NEW', 'NEW YORK', 'NEWS', 'NEWSPAPER', 'NEXT',
	'NICE', 'NIGHT', 'NINE', 'NITROGEN', 'NOBLE', 'NODE', 'NOISE', 'NOMINEE', 'NORMAL', 'NORTH',
	'NORWAY', 'NOTE', 'NOTEBOOK', 'NOVEL', 'NUCLEUS', 'NUMBER', 'NURSE', 'NUT', 'NYLON', 'OAK',
	'OASIS', 'OCCUR', 'OCEAN', 'ODDS', 'OFFICE', 'OFFSET', 'OIL', 'OLD', 'OLYMPIC', 'OMEGA',
	'ONION', 'OPEN', 'OPERA', 'OPINION', 'OPTICAL', 'ORANGE', 'ORBIT', 'ORDER', 'ORGAN', 'ORGANISM',
	'ORIGIN', 'OSLO', 'OTHER', 'OUTBREAK', 'OUTER', 'OUTLET', 'OVEN', 'OVER', 'OWNER', 'OXIDE',
	'OXYGEN', 'OYSTER', 'OZONE', 'PACKAGE', 'PADDLE', 'PAGE', 'PAID', 'PAINT', 'PAINTING', 'PALACE',
	'PAMPHLET', 'PANEL', 'PANIC', 'PAPER', 'PARACHUTE', 'PARK', 'PARKER', 'PART', 'PARTICLE', 'PARTY',
	'PASS', 'PASSENGER', 'PASSPORT', 'PASTE', 'PATCH', 'PATH', 'PATROL', 'PATTERN', 'PAUSE', 'PEACE',
	'PEACH', 'PEAK', 'PEANUT', 'PEARL', 'PEDAL', 'PELICAN', 'PEN', 'PENALTY', 'PENCIL', 'PENNY',
	'PERCH', 'PERFECT', 'PERIOD', 'PERMIT', 'PERSON', 'PHASE', 'PHONE', 'PHOTOGRAPH', 'PHYSICAL', 'PIANO',
	'PICK', 'PICNIC', 'PIECE', 'PIGEON', 'PILOT', 'PIN', 'PINE', 'PINK', 'PIPE', 'PIRATE',
	'PITCH', 'PIXEL', 'PIZZA', 'PLACE', 'PLAIN', 'PLAN', 'PLANE', 'PLANET', 'PLANT', 'PLASMA',
	'PLASTIC', 'PLATE', 'PLATINUM', 'PLAY', 'PLAYER', 'PLAYGROUND', 'PLAZA', 'PLEA', 'PLOT', 'POINT',
	'POISON', 'POKER', 'POLE', 'POLICE', 'POLITICAL', 'POLLUTION', 'POLO', 'POOL', 'POOR', 'POP',
	'POPE', 'POPPY', 'POPULATION', 'PORCH', 'PORT', 'POSITIVE', 'POST', 'POSTER', 'POT', 'POTATO',
	'POUCH', 'POULTRY', 'POUND', 'POWDER', 'POWER', 'PRACTICE', 'PRAISE', 'PRAYER', 'PREDATOR', 'PREFER',
	'PREMIER', 'PREMIUM', 'PREPARE', 'PRESENT', 'PRESIDENT', 'PRESS', 'PRICE', 'PRIDE', 'PRIEST', 'PRIMARY',
	'PRINTER', 'PRIORITY', 'PRISON', 'PRIZE', 'PROBE', 'PROBLEM', 'PROCESS', 'PRODUCE', 'PRODUCT', 'PROFESSOR',
	'PROGRAM', 'PROJECT', 'PROMISE', 'PROMOTION', 'PROMPT', 'PROOF', 'PROPER', 'PROPERTY', 'PROPOSAL', 'PROSE',
	'PROTECT', 'PROTEIN', 'PROTEST', 'PROUD', 'PROVE', 'PROVIDE', 'PROVINCE', 'PROVISION', 'PROXY', 'PUNISH',
	'PUNISHMENT', 'PUPIL', 'PUPPY', 'PURPLE', 'PURPOSE', 'PURSE', 'PUSH', 'PUT', 'PYRAMID', 'QUALITY',
	'QUANTITY', 'QUARREL', 'QUEEN', 'QUERY', 'QUESTION', 'QUICK', 'QUIET', 'QUITE', 'QUOTA', 'RABBIT',
	'RACE', 'RACKET', 'RADAR', 'RADIO', 'RAFT', 'RAGE', 'RAIL', 'RAIN', 'RAINBOW', 'RAISE',
	'RALLY', 'RANCH', 'RANGE', 'RAPID', 'RAT', 'RATE', 'RATIO', 'RAVEN', 'RAY', 'REACH',
	'REACT', 'READ', 'READER', 'REAL', 'REASON', 'REBEL', 'RECALL', 'RECEIPT', 'RECEIVE', 'RECENT',
	'RECIPE', 'RECORD', 'RECOVER', 'RECTANGLE', 'RED', 'REEF', 'REFER', 'REFLECT', 'REFORM', 'REGION',
	'REGRET', 'REJECT', 'RELATE', 'RELAX', 'RELAY', 'RELEASE', 'RELIEF', 'RELY', 'REMAIN', 'REMARK',
	'REMEDY', 'REMOTE', 'REMOVE', 'REPAIR', 'REPEAT', 'REPLACE', 'REPLY', 'REPORT', 'REQUEST', 'RESCUE',
	'RESEARCH', 'RESEMBLE', 'RESERVE', 'RESIGN', 'RESIST', 'RESOLUTION', 'RESORT', 'RESOURCE', 'RESPECT', 'RESPOND',
	'RESPONSE', 'REST', 'RESTAURANT', 'RESULT', 'RETAIL', 'RETAIN', 'RETIRE', 'RETREAT', 'RETURN', 'REVEAL',
	'REVENUE', 'REVIEW', 'REVOLUTION', 'REWARD', 'RHINO', 'RHYTHM', 'RICE', 'RICH', 'RIDER', 'RIDGE',
	'RIFLE', 'RIGHT', 'RIGID', 'RING', 'RIOT', 'RIPPLE', 'RISK', 'RIVAL', 'RIVER', 'ROAD',
	'ROAM', 'ROAR', 'ROAST', 'ROBOT', 'ROCK', 'ROCKET', 'ROCKY', 'RODEO', 'ROLE', 'ROLL',
	'ROOF', 'ROOM', 'ROOT', 'ROPE', 'ROSE', 'ROSES', 'ROSTER', 'ROUND', 'ROUTE', 'ROYAL',
	'RUBBER', 'RUGBY', 'RUIN', 'RULE', 'RULER', 'RURAL', 'RUSH', 'RUSSIA', 'RUST', 'SABBATH',
	'SACRED', 'SADDLE', 'SAFE', 'SAFETY', 'SAIL', 'SAINT', 'SALAD', 'SALARY', 'SALMON', 'SALON',
	'SALT', 'SALUTE', 'SAMURAI', 'SAND', 'SANDWICH', 'SATELLITE', 'SATURN', 'SAUCE', 'SAUNA', 'SCALE',
	'SCALP', 'SCANDIUM', 'SCAR', 'SCARE', 'SCARF', 'SCENE', 'SCENT', 'SCHEME', 'SCHOLAR', 'SCHOOL',
	'SCIENCE', 'SCISSORS', 'SCOUT', 'SCRAMBLE', 'SCRAP', 'SCRATCH', 'SCREAM', 'SCREEN', 'SCREW', 'SCRIPT',
	'SCUBA', 'SCULPTURE', 'SEAGULL', 'SEAL', 'SEAM', 'SEARCH', 'SEASON', 'SEAT', 'SECOND', 'SECRET',
	'SECTION', 'SECTOR', 'SECURE', 'SEED', 'SEGMENT', 'SELECT', 'SELF', 'SELL', 'SEMICONDUCTOR', 'SENATE',
	'SEND', 'SENIOR', 'SENSE', 'SENSOR', 'SENTENCE', 'SEPARATE', 'SEQUENCE', 'SERIES', 'SERVANT', 'SERVICE',
	'SET', 'SETTLE', 'SEVEN', 'SHADE', 'SHAFT', 'SHAKE', 'SHALLOW', 'SHAME', 'SHAPE', 'SHARE',
	'SHARK', 'SHARP', 'SHAVE', 'SHEEP', 'SHEET', 'SHELF', 'SHELL', 'SHELTER', 'SHIELD', 'SHIFT',
	'SHIN', 'SHIP', 'SHIRT', 'SHOCK', 'SHOE', 'SHOOT', 'SHOP', 'SHORE', 'SHORT', 'SHOT',
	'SHOULD', 'SHOULDER', 'SHOUT', 'SHOVEL', 'SHOW', 'SHOWER', 'SHOWROOM', 'SHREW', 'SHRIMP', 'SHRINE',
	'SHUT', 'SHUTTLE', 'SICK', 'SIDE', 'SIGHT', 'SIGN', 'SIGNAL', 'SILENCE', 'SILK', 'SILVER',
	'SIMPLE', 'SINGER', 'SINGLE', 'SINK', 'SITE', 'SITUATION', 'SIZE', 'SKILL', 'SKIN', 'SKIRT',
	'SKULL', 'SLAB', 'SLACK', 'SLATE', 'SLAVE', 'SLEEP', 'SLICE', 'SLIDE', 'SLOPE', 'SLOT',
	'SLOW', 'SLUG', 'SMALL', 'SMART', 'SMASH', 'SMELL', 'SMILE', 'SMITH', 'SMOKE', 'SMOOTH',
	'SNAKE', 'SNARE', 'SNATCH', 'SNOW', 'SOAP', 'SOCCER', 'SOCIAL', 'SOCKET', 'SODA', 'SOFA',
	'SOFT', 'SOIL', 'SOLAR', 'SOLDIER', 'SOLID', 'SOLO', 'SOLUTION', 'SORRY', 'SORT', 'SOUL',
	'SOUND', 'SOUP', 'SOURCE', 'SOUTH', 'SOUTHERN', 'SPACE', 'SPADE', 'SPAIN', 'SPARE', 'SPARK',
	'SPAWN', 'SPEAK', 'SPEAKER', 'SPECIAL', 'SPECIES', 'SPECIFIC', 'SPECTACLE', 'SPEED', 'SPELL', 'SPEND',
	'SPICE', 'SPIDER', 'SPIKE', 'SPILL', 'SPIN', 'SPINE', 'SPIRAL', 'SPIRIT', 'SPIT', 'SPLASH',
	'SPLIT', 'SPOIL', 'SPOKE', 'SPOON', 'SPORT', 'SPOT', 'SPRAY', 'SPREAD', 'SPRING', 'SQUAD',
	'SQUARE', 'SQUASH', 'SQUIRREL', 'STABLE', 'STACK', 'STADIUM', 'STAFF', 'STAGE', 'STAIN', 'STAIR',
	'STAKE', 'STALE', 'STAMP', 'STAND', 'STANDARD', 'STAPLE', 'STAR', 'START', 'STATE', 'STATION',
	'STATUE', 'STATUS', 'STAY', 'STEAK', 'STEAL', 'STEAM', 'STEEL', 'STEEP', 'STEER', 'STEM',
	'STEP', 'STERN', 'STEW', 'STICK', 'STIFF', 'STILL', 'STING', 'STOCK', 'STOMACH', 'STONE',
	'STOOL', 'STOP', 'STORE', 'STORM', 'STORY', 'STOVE', 'STRAIN', 'STRAND', 'STRANGE', 'STRAP',
	'STRAW', 'STREAM', 'STREET', 'STRESS', 'STRETCH', 'STRICT', 'STRIDE', 'STRIKE', 'STRING', 'STRIPE',
	'STROKE', 'STRONG', 'STRUCTURE', 'STRUGGLE', 'STUB', 'STUDENT', 'STUDIO', 'STUFF', 'STUMP', 'STYLE',
	'SUBJECT', 'SUBSTANCE', 'SUBURB', 'SUCCESS', 'SUCH', 'SUDDEN', 'SUFFER', 'SUGAR', 'SUGGEST', 'SUIT',
	'SUITCASE', 'SUM', 'SUMMER', 'SUMMIT', 'SUN', 'SUNDAY', 'SUNLIGHT', 'SUNRISE', 'SUNSET', 'SUPER',
	'SUPPLY', 'SUPPORT', 'SUPPOSE', 'SUPREME', 'SURE', 'SURFACE', 'SURGE', 'SURGERY', 'SURPRISE', 'SURROUND',
	'SURVEY', 'SURVIVAL', 'SUSPECT', 'SUSTAIN', 'SWALLOW', 'SWAMP', 'SWAN', 'SWAP', 'SWARM', 'SWEAR',
	'SWEAT', 'SWEEP', 'SWEET', 'SWELL', 'SWIFT', 'SWIM', 'SWING', 'SWISS', 'SWITCH', 'SWORD',
	'SYMBOL', 'SYMPHONY', 'SYMPTOM', 'SYRIA', 'SYSTEM', 'TABLE', 'TABLET', 'TACKLE', 'TACTIC', 'TAIL',
	'TAIWAN', 'TAKE', 'TALE', 'TALENT', 'TALK', 'TALL', 'TAME', 'TANK', 'TAPE', 'TARGET',
	'TAROT', 'TASK', 'TASTE', 'TAX', 'TEACH', 'TEACHER', 'TEAM', 'TEAR', 'TECHNICAL', 'TECHNOLOGY',
	'TEETH', 'TELEPHONE', 'TELESCOPE', 'TELEVISION', 'TELL', 'TEMPLE', 'TEMPORARY', 'TEND', 'TENDER', 'TENNIS',
	'TENOR', 'TENSE', 'TENT', 'TERM', 'TERMINAL', 'TERRACE', 'TERROR', 'TERRORIST', 'TEST', 'TEXT',
	'THANK', 'THEATER', 'THEFT', 'THEME', 'THEORY', 'THERAPY', 'THERMAL', 'THICK', 'THIEF', 'THIGH',
	'THING', 'THINK', 'THIRD', 'THORN', 'THOSE', 'THOUGHT', 'THOUSAND', 'THREAD', 'THREAT', 'THREE',
	'THRESHOLD', 'THRIFT', 'THRILL', 'THRONE', 'THROUGH', 'THROW', 'THRUST', 'THUNDER', 'THURSDAY', 'TICKET',
	'TIDE', 'TIGER', 'TIGHT', 'TIMBER', 'TIME', 'TIMID', 'TIN', 'TINY', 'TIRE', 'TISSUE',
	'TITANIUM', 'TITLE', 'TOAST', 'TOBACCO', 'TODAY', 'TOKEN', 'TOKYO', 'TOLD', 'TOLERANCE', 'TOMATO',
	'TOMORROW', 'TONE', 'TONGUE', 'TONIGHT', 'TOOL', 'TOOTH', 'TOP', 'TOPIC', 'TORCH', 'TORNADO',
	'TORPEDO', 'TOSS', 'TOTAL', 'TOUCH', 'TOUGH', 'TOUR', 'TOURIST', 'TOURNAMENT', 'TOWEL', 'TOWER',
	'TOWN', 'TRACK', 'TRADE', 'TRADITION', 'TRAFFIC', 'TRAGEDY', 'TRAIL', 'TRAIN', 'TRAIT', 'TRANSFER',
	'TRANSFORM', 'TRANSISTOR', 'TRANSITION', 'TRANSIT', 'TRANSLATE', 'TRANSMIT', 'TRAP', 'TRASH', 'TRAVEL', 'TREAT',
	'TREATY', 'TREBLE', 'TREE', 'TREKKING', 'TREND', 'TRIAL', 'TRIANGLE', 'TRIBE', 'TRICK', 'TRIED',
	'TRIM', 'TRIP', 'TROPHY', 'TROPICAL', 'TROUBLE', 'TRUCK', 'TRULY', 'TRUMPET', 'TRUNK', 'TRUST',
	'TRUTH', 'TUBE', 'TUESDAY', 'TULIP', 'TUMBLE', 'TUNA', 'TUNE', 'TUNNEL', 'TURKEY', 'TURN',
	'TURTLE', 'TWELVE', 'TWENTY', 'TWICE', 'TWIST', 'TYPE', 'TYPICAL', 'UGLY', 'ULTIMATE', 'UMBRELLA',
	'UNABLE', 'UNCLE', 'UNDER', 'UNDERGROUND', 'UNDERSTAND', 'UNDO', 'UNEMPLOYED', 'UNFAIR', 'UNHAPPY', 'UNIFORM',
	'UNION', 'UNIQUE', 'UNIT', 'UNITED KINGDOM', 'UNITED STATES', 'UNIVERSE', 'UNIVERSITY', 'UNKNOWN', 'UNLESS',
	'UNLIKE', 'UNLOAD', 'UNLOCK', 'UNTIL', 'UNUSUAL', 'UPGRADE', 'UPPER', 'UPSET', 'URBAN', 'URGE',
	'URUGUAY', 'USE', 'USED', 'USELESS', 'USER', 'USUAL', 'UTILITY', 'UTTER', 'VACANT', 'VACCINE',
	'VACUUM', 'VAGUE', 'VALID', 'VALLEY', 'VALUABLE', 'VALUE', 'VALVE', 'VAMPIRE', 'VAN', 'VAPOR',
	'VARIABLE', 'VARIETY', 'VARIOUS', 'VEGETABLE', 'VEHICLE', 'VEIN', 'VELVET', 'VENDOR', 'VENUS', 'VERB',
	'VERGE', 'VERSE', 'VERSION', 'VERY', 'VESSEL', 'VETERAN', 'VICTIM', 'VICTORY', 'VIDEO', 'VIEW',
	'VIGOR', 'VIKING', 'VILLA', 'VILLAGE', 'VINEGAR', 'VIOLIN', 'VIRGIN', 'VIRTUAL', 'VIRUS', 'VISA',
	'VISIBLE', 'VISION', 'VISIT', 'VISITOR', 'VISUAL', 'VITAL', 'VIVID', 'VOCABULARY', 'VOICE', 'VOLCANO',
	'VOLLEYBALL', 'VOLTAGE', 'VOLUME', 'VOLUNTEER', 'VOTE', 'VOYAGE', 'WAFER', 'WAGE', 'WAGON', 'WAIT',
	'WAKE', 'WALK', 'WALL', 'WALNUT', 'WALRUS', 'WALTER', 'WAND', 'WANT', 'WARDROBE', 'WAREHOUSE',
	'WARM', 'WARMTH', 'WARN', 'WARNING', 'WARRANT', 'WARRIOR', 'WARTIME', 'WASH', 'WASTE', 'WATCH',
	'WATER', 'WAVE', 'WAX', 'WEAK', 'WEALTH', 'WEAPON', 'WEAR', 'WEATHER', 'WEAVE', 'WEB',
	'WEDDING', 'WEEK', 'WEEKEND', 'WEIGH', 'WEIGHT', 'WEIRD', 'WELCOME', 'WELFARE', 'WELL', 'WELL-BEING',
	'WEST', 'WESTERN', 'WHALE', 'WHAT', 'WHEAT', 'WHEEL', 'WHEN', 'WHERE', 'WHETHER', 'WHICH',
	'WHILE', 'WHISKEY', 'WHISPER', 'WHITE', 'WHOLE', 'WHOSE', 'WICKED', 'WIDE', 'WIDOW', 'WIDTH',
	'WIFE', 'WILD', 'WILDCARD', 'WILL', 'WIND', 'WINDOW', 'WINE', 'WING', 'WINK', 'WINTER',
	'WIRE', 'WISDOM', 'WITCH', 'WITH', 'WITHDRAW', 'WITHIN', 'WITHOUT', 'WIZARD', 'WOLF', 'WOMAN',
	'WONDER', 'WOOD', 'WOOL', 'WORD', 'WORK', 'WORKER', 'WORKSHOP', 'WORLD', 'WORM', 'WORRY',
	'WORSE', 'WORSHIP', 'WORST', 'WORTH', 'WOUND', 'WRAP', 'WRATH', 'WREATH', 'WRECK', 'WRESTLE',
	'WRINKLE', 'WRIST', 'WRITE', 'WRITER', 'WRONG', 'YACHT', 'YELLOW', 'YESTERDAY', 'YIELD', 'YOGA',
	'YOKE', 'YOUNG', 'YOUTH', 'ZEBRA', 'ZERO', 'ZINC', 'ZIP', 'ZONE', 'ZOOM',
];

// Exported for use by the server-side game loop
export function generateGrid(): CodenamesCard[] {
	return generateGrid_();
}

// ── Helpers ─────────────────────────────────────────────────

function shuffle<T>(arr: readonly T[]): T[] {
	const result = [...arr];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j]!, result[i]!];
	}
	return result;
}

function generateGrid_(): CodenamesCard[] {
	// Pick 25 unique words
	const shuffledWords = shuffle(WORDS);
	const selectedWords = shuffledWords.slice(0, 25);

	// Assign card types:
	// 9 Red, 8 Blue, 7 Bystander, 1 Assassin = 25
	const typePool: CodenamesCardType[] = [];
	for (let i = 0; i < 9; i++) typePool.push('red');
	for (let i = 0; i < 8; i++) typePool.push('blue');
	for (let i = 0; i < 7; i++) typePool.push('bystander');
	typePool.push('assassin');

	const shuffledTypes = shuffle(typePool);

	return selectedWords.map((word, i) => ({
		word,
		type: shuffledTypes[i]!,
		revealed: false,
	}));
}

/**
 * Assign Codenames teams and roles to a list of player session IDs.
 * Exported for use by the server-side game loop.
 */
export function assignCodenamesRoles(
	players: string[],
	playerNames: Record<string, string>,
	_roomPlayers: { sessionId: string; displayName: string }[]
): CodenamesPlayerState[] {
	const midpoint = Math.ceil(players.length / 2);
	return players.map((sessionId, i) => {
		const isRed = i < midpoint;
		// First player on each team (index 0 or midpoint) is the spymaster
		const isSpymaster = i === 0 || i === midpoint;
		return {
			sessionId,
			displayName: playerNames[sessionId] ?? 'Player',
			team: (isRed ? 'red' : 'blue') as CodenamesTeam,
			role: (isSpymaster ? 'spymaster' : 'operative') as 'spymaster' | 'operative',
		};
	});
}

// ----- Phase helpers -----

function nextTeam(team: CodenamesTeam): CodenamesTeam {
	return team === 'red' ? 'blue' : 'red';
}

// Count remaining unrevealed cards of each type
function countRemaining(grid: CodenamesCard[], type: CodenamesCardType): number {
	return grid.filter((c) => !c.revealed && c.type === type).length;
}

// ----- Standalone engine helpers (called by applyMove / getValidMoves) -----
// These are module-level functions so they can be called from applyMove without
// needing to be methods on the GameEngine interface.

function applyClueGiven_(
	state: CodenamesState,
	move: CodenamesMove,
	playerId: string
): MoveResult<CodenamesState> {
	if (move.type !== 'GIVE_CLUE') {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Expected GIVE_CLUE.' } };
	}

	const player = state.playerStates.find((p) => p.sessionId === playerId);
	if (!player) {
		return { ok: false, error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' } };
	}

	if (player.role !== 'spymaster') {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Only the spymaster can give clues.' } };
	}
	if (player.team !== state.activeTeam) {
		return { ok: false, error: { code: 'INVALID_MOVE', message: "It's not your team's turn to give a clue." } };
	}

	const { word, number } = move;
	if (number < 0 || number > 9) {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Clue number must be between 0 and 9.' } };
	}
	if (!word || word.trim().length === 0) {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Clue word cannot be empty.' } };
	}
	const normalizedWord = word.trim().toUpperCase();
	const onBoard = state.grid.some(
		(c) => !c.revealed && c.word.toUpperCase() === normalizedWord
	);
	if (onBoard) {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Clue word cannot be a word on the board.' } };
	}

	return {
		ok: true,
		state: {
			...state,
			phase: 'guessing',
			currentClue: { word: normalizedWord, number },
			guessesRemaining: number + 1,
			lastRevealedIndex: null,
			moveCount: state.moveCount + 1,
			updatedAt: Date.now(),
		},
	};
}

function endTurn_(state: CodenamesState): MoveResult<CodenamesState> {
	const nextActive = nextTeam(state.activeTeam);
	const newStartingTeam = state.startingTeam === state.activeTeam ? nextActive : state.startingTeam;
	return {
		ok: true,
		state: {
			...state,
			phase: 'clue',
			activeTeam: nextActive,
			startingTeam: newStartingTeam,
			currentClue: null,
			guessesRemaining: 0,
			lastRevealedIndex: null,
			updatedAt: Date.now(),
		},
	};
}

function applyGuessing_(
	state: CodenamesState,
	move: CodenamesMove,
	playerId: string
): MoveResult<CodenamesState> {
	const player = state.playerStates.find((p) => p.sessionId === playerId);
	if (!player) {
		return { ok: false, error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' } };
	}
	if (player.role !== 'operative') {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Only operatives can guess cards.' } };
	}
	if (player.team !== state.activeTeam) {
		return { ok: false, error: { code: 'INVALID_MOVE', message: "It's not your team's turn to guess." } };
	}

	// PASS — end turn early
	if (move.type === 'PASS') {
		return endTurn_(state);
	}

	if (move.type !== 'GUESS') {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Expected GUESS or PASS.' } };
	}

	const { cardIndex } = move;
	if (cardIndex < 0 || cardIndex >= state.grid.length) {
		return { ok: false, error: { code: 'MOVE_OUT_OF_RANGE', message: 'Card index out of range.' } };
	}

	const card = state.grid[cardIndex]!;
	if (card.revealed) {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'That card has already been revealed.' } };
	}

	// Reveal the card
	const newGrid = state.grid.map((c, i) =>
		i === cardIndex ? { ...c, revealed: true } : c
	);
	const newGuessesRemaining = state.guessesRemaining - 1;

	const newState: CodenamesState = {
		...state,
		grid: newGrid,
		lastRevealedIndex: cardIndex,
		guessesRemaining: newGuessesRemaining,
		moveCount: state.moveCount + 1,
		updatedAt: Date.now(),
	};

	// Assassin — the team that revealed it loses
	if (card.type === 'assassin') {
		const winningTeam = nextTeam(state.activeTeam);
		return {
			ok: true,
			state: {
				...newState,
				phase: 'game_end',
				winner: winningTeam,
				gameEndReason: `${winningTeam === 'red' ? 'Red' : 'Blue'} team wins — ${state.activeTeam === 'red' ? 'Red' : 'Blue'} team revealed the Assassin!`,
				updatedAt: Date.now(),
			},
		};
	}

	// Friendly agent — check if team won (uses newGrid so count is accurate)
	if (card.type === state.activeTeam) {
		if (countRemaining(newGrid, state.activeTeam) === 0) {
			return {
				ok: true,
				state: {
					...newState,
					phase: 'game_end',
					winner: state.activeTeam,
					gameEndReason: `${state.activeTeam === 'red' ? 'Red' : 'Blue'} team found all their agents!`,
					updatedAt: Date.now(),
				},
			};
		}
		// Guesses exhausted → end turn
		if (newGuessesRemaining <= 0) {
			return endTurn_(newState);
		}
		return { ok: true, state: newState };
	}

	// Opposing team agent or bystander → turn ends, other team starts
	const nextActive = nextTeam(state.activeTeam);
	const newStartingTeam = state.startingTeam === state.activeTeam ? nextActive : state.startingTeam;
	return {
		ok: true,
		state: {
			...newState,
			phase: 'clue',
			activeTeam: nextActive,
			startingTeam: newStartingTeam,
			currentClue: null,
			guessesRemaining: 0,
			lastRevealedIndex: null,
			updatedAt: Date.now(),
		},
	};
}

// ----- Engine -----

export const codenamesEngine: GameEngine<
	CodenamesState,
	CodenamesMove
> = {
	gameType: 'codenames',
	minPlayers: 4, // 2 per team minimum (1 spymaster + 1 operative)
	maxPlayers: 8,  // 4 per team maximum
	name: 'Codenames',
	description:
		'Social word game for 4-8 players. Two rival spymasters give one-word clues to identify hidden agents on a 5×5 grid.',
	slug: 'codenames',
	icon: '🔐',

	createInitialState(players: string[]): CodenamesState {
		const playerCount = players.length;
		// Team assignment: first half = red, second half = blue
		// Within each team: first player = spymaster, rest = operatives
		const midpoint = Math.ceil(playerCount / 2);
		const playerStates: CodenamesPlayerState[] = players.map((sessionId, i) => {
			const isRed = i < midpoint;
			const team: CodenamesTeam = isRed ? 'red' : 'blue';
			// First player on each team (index 0 or midpoint) is the spymaster
			const isSpymaster = i === 0 || i === midpoint;
			return {
				sessionId,
				displayName: 'Player',
				team,
				role: isSpymaster ? 'spymaster' : 'operative',
			};
		});

		return {
			gameType: 'codenames',
			players,
			turn: players[0]!, // first spymaster goes first
			moveCount: 0,
			phase: 'waiting',
			grid: [],
			activeTeam: 'red',
			currentClue: null,
			guessesRemaining: 0,
			lastRevealedIndex: null,
			startingTeam: 'red',
			playerStates,
			winner: null,
			gameEndReason: undefined,
			updatedAt: Date.now(),
		};
	},

	applyMove(state: CodenamesState, move: CodenamesMove, playerId: string): MoveResult<CodenamesState> {
		// Player must be in game
		const playerIndex = state.players.indexOf(playerId);
		if (playerIndex === -1) {
			return { ok: false, error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' } };
		}

		// Game over?
		if (state.phase === 'game_end' || state.winner) {
			return { ok: false, error: { code: 'GAME_OVER', message: 'Game has already ended.' } };
		}

		// Waiting / role_assignment — no moves accepted
		if (state.phase === 'waiting' || state.phase === 'role_assignment') {
			return { ok: false, error: { code: 'INVALID_MOVE', message: 'Game has not started yet.' } };
		}

		switch (state.phase) {
			case 'clue':
				return applyClueGiven_(state, move, playerId);
			case 'guessing':
				return applyGuessing_(state, move, playerId);
			default:
				return { ok: false, error: { code: 'INVALID_MOVE', message: `Unknown phase: ${state.phase}` } };
		}
	},

	checkGameEnd(state: CodenamesState): GameEnd | null {
		if (!state.winner) return null;
		return {
			winner: state.winner,
			reason: (state.gameEndReason as GameEnd['reason']) ?? 'TIME_OUT',
		};
	},

	serialize(state: CodenamesState): string {
		return JSON.stringify(state);
	},

	deserialize(data: string): CodenamesState {
		return JSON.parse(data) as CodenamesState;
	},

	isValidMove(state: CodenamesState, move: CodenamesMove, playerId: string): boolean {
		return this.applyMove(state, move, playerId).ok;
	},

	getValidMoves(state: CodenamesState, playerId: string): CodenamesMove[] {
		if (state.phase === 'game_end' || state.winner) return [];
		if (state.phase === 'waiting' || state.phase === 'role_assignment') return [];

		const player = state.playerStates.find((p) => p.sessionId === playerId);
		if (!player) return [];

		if (state.phase === 'clue') {
			if (player.role === 'spymaster' && player.team === state.activeTeam) {
				// Spymaster can give any valid clue; return placeholder
				// Actual validation happens in applyMove
				return [{ type: 'GIVE_CLUE', word: '', number: 0 }];
			}
			return [];
		}

		if (state.phase === 'guessing') {
			if (player.role === 'operative' && player.team === state.activeTeam) {
				const guesses: CodenamesMove[] = state.grid
					.filter((c) => !c.revealed)
					.map((_, i) => ({ type: 'GUESS' as const, cardIndex: i }));
				guesses.push({ type: 'PASS' });
				return guesses;
			}
			return [];
		}

		return [];
	},
};

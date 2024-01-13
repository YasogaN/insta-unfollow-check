import { IgApiClient, IgLoginTwoFactorRequiredError } from 'instagram-private-api';
import fs from 'fs';
import dotenv from 'dotenv';
import Bluebird from 'bluebird';
import inquirer from 'inquirer';
import { promisify } from 'util';

const writeFileAsync = promisify(fs.writeFile);
const renameAsync = promisify(fs.rename);
const rmAsync = promisify(fs.rm);

dotenv.config();

const ig = new IgApiClient();

main();

async function main() {
    await checkenv();
    await login();
    await getFollowers();
    await compare();
    await rename();
};

async function checkenv() {
    const check = fs.existsSync('.env');
    if (!check) {
        console.log("No .env file found. Creating one now.\n");
        const { username, password } = await inquirer.prompt([
            {
                type: 'input',
                name: 'username',
                message: `Enter instagram username:`,
            },
            {
                type: 'input',
                name: 'password',
                message: `Enter instagram password:`,
            },
        ]);
        fs.writeFile('.env', `IG_USERNAME=${username}\nIG_PASSWORD=${password}`, (err) => {
            if (err) throw err;
            console.log(`\n.env file created.`);
            console.log('Please start the program again.')
            process.exit();
        });
    }
}

async function getAllItemsFromFeed(feed) {
    let items = [];
    do {
        items = items.concat(await feed.items());
    } while (feed.isMoreAvailable());
    return items;
}

async function remove() {
    if (fs.existsSync('history.txt')) {
        await rmAsync('history.txt', (err) => {
            if (err) {
                console.error(err)
            }
        })
    }
}

async function rename() {
    if (fs.existsSync('followers.txt')) {
        await renameAsync(`followers.txt`, 'history.txt');
        console.log('\nfollowers.txt was renamed to history.txt successfully!');
    }
}

async function getFollowers() {
    const followersFeed = ig.feed.accountFollowers(ig.state.cookieUserId);
    console.log('\nGetting followers...');
    const followers = await getAllItemsFromFeed(followersFeed);
    // Making a new map of users username that follow you.
    const followersUsername = new Set(followers.map(({ username }) => username));
    // Save the usernames to a text file with the current date appended to the filename
    await writeFileAsync(`followers.txt`, Array.from(followersUsername).join('\n'), (err) => {
        if (err) throw err;
        console.log(`\nUsernames of followers saved to followers.txt`);
    });
}

async function login() {
    ig.state.generateDevice(process.env.IG_USERNAME);
    return Bluebird.try(() => ig.account.login(process.env.IG_USERNAME, process.env.IG_PASSWORD)).catch(
        IgLoginTwoFactorRequiredError,
        async err => {
            const { username, totp_two_factor_on, two_factor_identifier } = err.response.body.two_factor_info;
            // decide which method to use
            const verificationMethod = totp_two_factor_on ? '0' : '1'; // default to 1 for SMS
            // At this point a code should have been sent
            // Get the code
            console.log(''); // new line
            const { code } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'code',
                    message: `Enter code received via ${verificationMethod === '1' ? 'SMS' : 'TOTP'}`,
                },
            ]);
            // Use the code to finish the login process
            return ig.account.twoFactorLogin({
                username,
                verificationCode: code,
                twoFactorIdentifier: two_factor_identifier,
                verificationMethod, // '1' = SMS (default), '0' = TOTP (google auth for example)
                trustThisDevice: '1', // Can be omitted as '1' is used by default
            });
        })
        .then(async loggedInUser => {
            console.log(`Logged in successfully as ${loggedInUser.username} (${loggedInUser.full_name})`);
        });
}

async function compare() {
    console.log('Comparing followers...');
    if (fs.existsSync('history.txt')) {

        const history = fs.readFileSync('history.txt', 'utf8').split('\n');
        const followers = fs.readFileSync('followers.txt', 'utf8').split('\n');

        const unfollowers = history.filter(x => !followers.includes(x));
        const newFollowers = followers.filter(x => !history.includes(x));

        if (unfollowers.length === 0) {
            unfollowers.push('No new unfollowers.');
        }
        if (newFollowers.length === 0) {
            newFollowers.push('No new followers.');
        }

        console.log('\nSaving unfollowers and new followers');

        await save(unfollowers, newFollowers);
    } else {
        console.log('Cannot compare followers. No history.txt file found. Exiting...');
    }
}

async function save(unfollowers, newFollowers){
    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
    const datetime = date + '_' + time;

    const unf_dir = 'unfollowers'; 
    fs.mkdirSync(unf_dir, { recursive: true });
    const f_dir = 'newfollowers'; 
    fs.mkdirSync(f_dir, { recursive: true })

    try {
        await writeFileAsync(`${unf_dir}/unfollowers-as-of-${datetime}.txt`, unfollowers.join('\n'));
        console.log(`Usernames of unfollowers saved to ${unf_dir}/unfollowers-as-of-${datetime}.txt`);

        await writeFileAsync(`${f_dir}/newfollowers-as-of-${datetime}.txt`, newFollowers.join('\n'));
        console.log(`Usernames of new followers saved to ${f_dir}/newfollowers-as-of-${datetime}.txt`);
    } catch (err) {
        console.error('Error saving files:', err);
    }
}
import puppeteer from 'puppeteer';
import {createLogger, format, transports} from "winston";
import {Selector} from "./enums/selector";
import {Messages} from "./enums/messages";

require("dotenv").config();

const logger = createLogger({
    level: 'info',
    format: format.json(),
    defaultMeta: {service: 'crawler-service'},
    transports: [
        new transports.File({filename: 'error.log', level: 'error'}),
        new transports.File({filename: 'info.log'}),
    ],
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new transports.Console({
        format: format.combine(format.timestamp(), format.prettyPrint({colorize: true})),
    }));
}

// IIFE
(async () => {
    try {
        logger.info('initializing script');
        const username = process.env.USER;
        const password = process.env.PASS;

        const browser = await puppeteer.launch();
        const page = await browser.newPage();

        logger.info('goto login page');
        await page.goto(process.env.GYM_WEB);

        // Set screen size
        await page.setViewport({width: 1080, height: 1024});

        // Type credentials
        logger.info('entering credentials', {username: username, password: password});
        await page.type(Selector.USERNAME_FIELD, username);
        await page.type(Selector.PASSWORD_FIELD, password);

        // Click login button
        logger.info('sign-in button click');
        await page.click(Selector.BTN);

        // Wait for main page
        await page.waitForNavigation();

        // Go to booking section
        logger.info('goto booking section');
        await page.goto(process.env.GYM_BOOKING);
        await page.waitForNetworkIdle();

        // Select Option Menu
        logger.info('combobox service selection');
        await page.select(Selector.SERVICES_COMBOBOX, Selector.SERVICES_TRAINING_GROUND_ID);

        // Wait for calendar
        await page.waitForSelector(Selector.CALENDAR, {visible: true});


        // Select the available days in the calendar
        logger.info('getting available days');
        await page.waitForSelector(Selector.ACTIVE_DAY_LIST_ELEMENT);
        const days = await page.$$(Selector.ACTIVE_DAY_LIST_ELEMENT);

        // Filter available days greater than today
        const availableDays = await Promise.all(days.map((day) => day.evaluate((node) => Number(node.textContent))))
            .then((filteredDays) => days.filter((_, index) => filteredDays[index] > new Date().getDate()));

        // Loop through available days
        for (const day of availableDays) {
            logger.info('attempting to book date', {
                date: (await day.evaluate(n => n.textContent)).replace(/\s+/g, '')
            });
            const dayButton = await day.waitForSelector(Selector.SPAN, {visible: true});
            // Click to open the time schedule
            await dayButton.click();
            await page.waitForNetworkIdle();

            // Wait for timetable modal
            logger.info('waiting for timetable modal');
            const modal = await page.waitForSelector(Selector.TIMETABLE_MODAL, {visible: true, timeout: 2000});

            // Get the table
            logger.info('waiting for table');
            const rows = await page.$$(Selector.ROWS);

            // Loop through table rows
            for (const row of rows) {
                // Get the column with the hour range information
                const targetTime = '[ 08:00 - 09:00 ]';
                logger.info('searching row timerange schedule', {timerange: targetTime});
                const column = await row.$(Selector.FIRST_COLUMN);
                const columnContent = await column.evaluate(node => node.textContent);
                // Check if the current iteration match the targeted hour
                if (columnContent.includes(targetTime)) {
                    logger.info('row timerange found', {timerange: targetTime});
                    // Click the request hour button
                    logger.info('getting the request button');
                    const requestHourButton = await row.waitForSelector(Selector.BUTTON, {visible: true});
                    await requestHourButton.click();
                    await page.waitForNetworkIdle();
                    // Check if the hour confirmation modal is displayed
                    logger.info('waiting for confirmation modal');
                    await page.waitForSelector(Selector.CONFIRM_BOOKING_MODAL, {visible: true});
                    // Click the accept button to confirm the hour
                    logger.info('waiting for accept button');
                    const acceptButton = await page.waitForSelector(Selector.ACCEPT_BUTTON, {visible: true});
                    await acceptButton.click();
                    await page.waitForNetworkIdle();
                    // Get the error message (always in the DOM)
                    const errorMessage = await page.$(Selector.ERROR_MESSAGE_LABEL);
                    // If there is an existing booking, an error message text will be displayed
                    const errorMessageTargetContent = Messages.BOOKING_ALREADY_EXISTS;
                    logger.info('checking error message');
                    const errorMessageContent = await errorMessage.evaluate(node => node.textContent);
                    // Handle an existing booking
                    if (errorMessageContent.includes(errorMessageTargetContent)) {
                        // Close the modal
                        logger.info('existing booking found');
                        const dismissButton = await page.$(Selector.DISMISS_BUTTON);
                        await dismissButton.click();
                        // Otherise booking successful
                    } else {
                        // Close the modal
                        logger.info('booking successful');
                        const closeButton = await page.$(Selector.CLOSE_BUTTON);
                        await closeButton.click();
                    }
                    // Wait for confirmation modal to close
                    await page.waitForNetworkIdle();
                    logger.info('waiting for confirmation modal to close');
                    await page.waitForSelector(Selector.CONFIRM_BOOKING_MODAL, {visible: false});
                    break;
                }
            }
        }
        await browser.close();
        logger.info('process finished');
    } catch (e) {
        logger.error(e);
        process.exit(0);
    }

})();
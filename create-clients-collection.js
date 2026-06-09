import { Client, Databases } from 'node-appwrite';

const client = new Client()
    .setEndpoint('https://cloud.appwrite.io/v1')
    .setProject('6a27fc2800189d6cffed')
    .setKey('standard_ec202a020e3ed7a850c52d78a5f0f839be1d5e0a1b42c70542a0f01801912723d09870ddb815bf25f965ed89992c23e393fea3af4be0425157f9dec01d88207d94e367073a227f43aa7a6fd572d96fa277948b7d048975f1d45c0a2c692378cb7a19c9366b8a726881e0395906f6aefd6db96dc8f2348d2aaeb2e438e7837deb'); // Replace with a newly generated API key

const databases = new Databases(client);

const DATABASE_ID = '6a27fe0f0008e45ab951';
const COLLECTION_ID = 'clients';

async function createClientsCollection() {
    try {
        console.log('Creating clients collection...');

        // Create Collection
        const collection = await databases.createCollection(
            DATABASE_ID,
            COLLECTION_ID,
            'Clients'
        );

        console.log('✅ Clients collection created:', collection.$id);

        // Define Attributes
        const attributes = [
            { key: 'client_name', size: 150, required: true },
            { key: 'business_name', size: 200, required: true },
            { key: 'business_type', size: 100, required: false },
            { key: 'industry', size: 100, required: false },
            { key: 'tax_identification_number', size: 50, required: false },
            { key: 'website', size: 255, required: false },
            { key: 'email', size: 150, required: true },
            { key: 'phone_number', size: 20, required: false },
            { key: 'country', size: 100, required: false },
            { key: 'state', size: 100, required: false },
            { key: 'city', size: 100, required: false },
            { key: 'address', size: 1000, required: false },
            { key: 'primary_contact_name', size: 150, required: false },
            { key: 'primary_contact_designation', size: 100, required: false },
            { key: 'primary_contact_email', size: 150, required: false },
            { key: 'primary_contact_phone', size: 20, required: false },
            { key: 'fiscal_year_start', size: 20, required: false },
            { key: 'accounting_software', size: 100, required: false },
            { key: 'notes', size: 2000, required: false },
            {
                key: 'onboarding_status',
                size: 50,
                required: false,
                default: 'Pending'
            },
            { key: 'created_by', size: 100, required: false }
        ];

        // Create Attributes
        for (const attr of attributes) {
            console.log(`Creating attribute: ${attr.key}`);

            await databases.createStringAttribute(
                DATABASE_ID,
                COLLECTION_ID,
                attr.key,
                attr.size,
                attr.required,
                attr.default || undefined
            );

            console.log(`✅ Created attribute: ${attr.key}`);
        }

        console.log('🎉 Clients collection setup completed!');

    } catch (error) {
        console.error('❌ Error creating collection:');
        console.error(JSON.stringify(error, null, 2));
    }
}

createClientsCollection();